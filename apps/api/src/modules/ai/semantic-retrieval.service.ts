import { createHash } from 'crypto';
import { createRequire } from 'module';
import { Injectable, Logger } from '../../common/exceptions';
import { PrismaService } from '../../prisma/prisma.service';

export const SEMANTIC_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const SEMANTIC_DIMENSIONS = 384;
export function isMoodSearch(text: string): boolean {
  return /\b(chill|relax(?:ed|ing)?|calm|peaceful|quiet|energetic|lively|romantic|family.friendly|kid.friendly|cozy|cosy|intimate|mood|vibes?|aaram|sukoon|shaant|shant|mahaul)\b/i.test(text);
}
type Extractor = (texts: string[], options: { pooling: 'mean'; normalize: true }) => Promise<{ tolist(): number[][] }>;
type Source = { id: string; title: string; description: string; shortDescription: string | null; tags: string[]; updatedAt: Date; category: { name: string } };

/** Local pretrained sentence embeddings; no event/user text is sent to an embedding API. */
@Injectable()
export class SemanticRetrievalService {
  private readonly logger = new Logger(SemanticRetrievalService.name);
  private extractor?: Promise<Extractor>;
  private indexing?: Promise<void>;
  private indexFreshUntil = 0;
  private indexRevision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly queryCache = new Map<string, number[]>();

  constructor(private readonly prisma: PrismaService) {}

  get enabled() { return process.env.SEMANTIC_RAG_ENABLED !== 'false'; }

  async warmup(): Promise<void> {
    if (!this.enabled) return;
    try { await this.getExtractor(); } catch { this.logger.warn('Semantic encoder warmup unavailable; keyword search remains available'); }
  }

  private getExtractor(): Promise<Extractor> {
    if (!this.extractor) {
      this.extractor = (async () => {
        // Lazy CommonJS entry avoids loading native inference libraries for ordinary searches.
        const transformers = createRequire(__filename)('@huggingface/transformers') as {
          env: { allowLocalModels: boolean; cacheDir: string };
          pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<Extractor>;
        };
        transformers.env.allowLocalModels = false;
        if (process.env.SEMANTIC_MODEL_CACHE_DIR) transformers.env.cacheDir = process.env.SEMANTIC_MODEL_CACHE_DIR;
        return transformers.pipeline('feature-extraction', SEMANTIC_MODEL, {
          dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
        });
      })().catch((error: unknown) => { this.extractor = undefined; throw error; });
    }
    return this.extractor;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const work = this.queue.then(async () => {
      const extractor = await this.getExtractor();
      const rows = (await extractor(texts, { pooling: 'mean', normalize: true })).tolist();
      if (rows.length !== texts.length || rows.some(row => row.length !== SEMANTIC_DIMENSIONS || row.some(value => !Number.isFinite(value)))) {
        throw new Error('Invalid sentence embedding output');
      }
      return rows;
    });
    this.queue = work.catch(() => undefined);
    return work;
  }

  /** Hashes ensure edits are re-embedded. Live SQL checks version timestamps too. */
  invalidateIndex(): void { this.indexRevision++; this.indexFreshUntil = 0; }

  async refreshIndex(): Promise<void> {
    if (this.indexing) return this.indexing;
    if (Date.now() < this.indexFreshUntil) return;
    const revision = this.indexRevision;
    this.indexing = this.indexPublished().then(() => {
      if (revision === this.indexRevision) this.indexFreshUntil = Date.now() + 15_000;
    }).finally(() => { this.indexing = undefined; });
    return this.indexing;
  }

  private async indexPublished(): Promise<void> {
    const events: Source[] = await this.prisma.event.findMany({
      where: { status: 'PUBLISHED', startDate: { gte: new Date() } },
      select: { id: true, title: true, description: true, shortDescription: true, tags: true, updatedAt: true, category: { select: { name: true } } },
    });
    const indexed = await this.prisma.$queryRaw<{ event_id: string; content_hash: string; source_updated_at: Date }[]>`
      SELECT event_id, content_hash, source_updated_at FROM event_semantic_embeddings WHERE model = ${SEMANTIC_MODEL}`;
    const existing = new Map(indexed.map(row => [row.event_id, row]));
    const pending = events.map(event => {
      const text = [event.title, event.category.name, event.tags.join(', '), event.shortDescription, event.description].filter(Boolean).join('. ').slice(0, 5000);
      return { event, text, hash: createHash('sha256').update(text).digest('hex') };
    }).filter(row => existing.get(row.event.id)?.content_hash !== row.hash || existing.get(row.event.id)?.source_updated_at.getTime() !== row.event.updatedAt.getTime());
    for (let i = 0; i < pending.length; i += 4) {
      const batch = pending.slice(i, i + 4);
      const vectors = await this.embed(batch.map(row => row.text));
      for (let j = 0; j < batch.length; j++) {
        const { event, hash } = batch[j];
        await this.prisma.$executeRaw`
          INSERT INTO event_semantic_embeddings (event_id, model, content_hash, source_updated_at, embedding, updated_at)
          SELECT ${event.id}, ${SEMANTIC_MODEL}, ${hash}, ${event.updatedAt}, ${vectors[j]}::double precision[], NOW()
          WHERE EXISTS (SELECT 1 FROM events WHERE id = ${event.id})
          ON CONFLICT (event_id) DO UPDATE SET model=EXCLUDED.model, content_hash=EXCLUDED.content_hash,
            source_updated_at=EXCLUDED.source_updated_at, embedding=EXCLUDED.embedding, updated_at=NOW()
          WHERE EXCLUDED.source_updated_at >= event_semantic_embeddings.source_updated_at`;
      }
    }
    this.logger.log(`Semantic index checked: ${events.length} published events; ${pending.length} refreshed`);
  }

  async queryVector(query: string): Promise<number[] | null> {
    if (!this.enabled) return null;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([this.refreshIndex(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Semantic index warming')), 10_000); })]);
      } finally { if (timer) clearTimeout(timer); }
      const key = query.trim().toLowerCase();
      const cached = this.queryCache.get(key);
      if (cached) return cached;
      const [vector] = await this.embed([query.slice(0, 500)]);
      if (this.queryCache.size >= 100) this.queryCache.delete(this.queryCache.keys().next().value!);
      this.queryCache.set(key, vector);
      return vector;
    } catch {
      this.logger.warn('Semantic retrieval unavailable; falling back to keyword filtering');
      return null;
    }
  }
}
