import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AiChatInput } from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { GroqKeyPool, parseRetryAfterMs } from './groq-key-pool';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LlmCompletionResponse {
  choices?: { message?: { content?: string } }[];
}

/**
 * Shape mirrors the web app's EventSummary so the frontend can render the
 * existing <EventCard> directly. Every field comes from real catalog rows —
 * the model can only reference events, never define them.
 */
export interface AiEventCard {
  id: string;
  title: string;
  slug: string;
  shortDescription: string | null;
  startDate: string;
  endDate: string;
  images: string[];
  isFeatured: boolean;
  minPrice: number | null;
  maxPrice: number | null;
  category: { id: string; name: string; slug: string };
  venue: { id: string; name: string; city: string };
  organizer: { id: string; organizationName: string };
}

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TIMEOUT_MS = 30_000;
/** Bounded work per request: at most one attempt per key plus one transient retry. */
const GROQ_TRANSIENT_RETRIES = 1;
const GROQ_TRANSIENT_BACKOFF_MS = 500;

/**
 * EventAI assistant backed by Groq via the OpenAI-compatible
 * chat-completions API. The live catalog of upcoming events is injected
 * into the system prompt so recommendations are grounded in real data.
 *
 * Multi-key management: keys come from GROQ_API_KEYS (comma-separated,
 * extensible without code changes) or the legacy single GROQ_API_KEY.
 * 401/403 rotates to the next key; 429 never rotates (shared org quota) —
 * it rejects with a Retry-After hint; transient failures retry once.
 * Degrades gracefully: without any usable key the endpoint returns 503.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly keyPool: GroqKeyPool;

  constructor(private readonly prisma: PrismaService) {
    const raw = process.env.GROQ_API_KEYS ?? process.env.GROQ_API_KEY ?? '';
    this.keyPool = new GroqKeyPool(raw.split(','));
  }

  isConfigured(): boolean {
    return this.keyPool.size > 0;
  }

  private async loadCatalog() {
    const events = await this.prisma.event.findMany({
      where: { status: 'PUBLISHED', startDate: { gte: new Date() } },
      orderBy: { startDate: 'asc' },
      take: 12,
      select: {
        title: true,
        slug: true,
        startDate: true,
        category: { select: { name: true } },
        venue: { select: { city: true } },
        ticketTypes: {
          where: { isActive: true },
          select: { price: true },
          orderBy: { price: 'asc' },
          take: 1,
        },
      },
    });
    return events.map((e) => ({
      title: e.title,
      slug: e.slug,
      startDate: e.startDate,
      city: e.venue.city,
      category: e.category.name,
      minPrice: e.ticketTypes[0]?.price ?? null,
    }));
  }

  private async callGroq(
    key: string,
    payload: ChatMessage[],
  ): Promise<Response> {
    return fetch(GROQ_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
        messages: payload,
        temperature: 0.6,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });
  }

  private unavailable(message: string, retryAfterSeconds?: number): never {
    throw new ServiceUnavailableException(
      retryAfterSeconds === undefined
        ? { statusCode: 503, message }
        : { statusCode: 503, message, retryAfterSeconds },
    );
  }

  /**
   * Strips the machine-readable `EVENTS: slug1, slug2` trailer the model is
   * instructed to append and returns the referenced slugs. Malformed output
   * (missing line) simply yields no events — the prose is still shown.
   */
  private extractRecommendedSlugs(reply: string): { reply: string; slugs: string[] } {
    // Tolerate markdown decoration the model sometimes adds (**EVENTS:** etc.).
    const match = reply.match(/(^|\n)[*_\s]*EVENTS[*_\s]*:\s*([^\n]+)\s*$/i);
    if (!match) return { reply: reply.trim(), slugs: [] };
    const slugs = match[2]
      .split(/[,\s]+/)
      .map((s) =>
        s
          .replace(/^\/?events\//i, '')
          .replace(/^[*_\s]+|[*_\s]+$/g, '')
          .trim(),
      )
      .filter(Boolean);
    const prose = (
      reply.slice(0, match.index ?? 0) + reply.slice((match.index ?? 0) + match[0].length)
    ).trim();
    return { reply: prose, slugs };
  }

  /** Loads only real, published, upcoming catalog rows for the given slugs. */
  private async mapRecommendedEvents(slugs: string[]): Promise<AiEventCard[]> {
    if (slugs.length === 0) return [];
    const events = await this.prisma.event.findMany({
      where: {
        slug: { in: slugs },
        status: 'PUBLISHED',
        startDate: { gte: new Date() },
      },
      select: {
        id: true,
        title: true,
        slug: true,
        shortDescription: true,
        startDate: true,
        endDate: true,
        images: true,
        coverImage: true,
        isFeatured: true,
        category: { select: { id: true, name: true, slug: true } },
        venue: { select: { id: true, name: true, city: true } },
        organizer: { select: { id: true, organizationName: true } },
        ticketTypes: {
          where: { isActive: true },
          select: { price: true },
          orderBy: { price: 'asc' },
        },
      },
    });
    // Preserve the model's recommendation order when possible.
    const bySlug = new Map(events.map((e) => [e.slug, e]));
    const ordered = slugs
      .map((s) => bySlug.get(s))
      .filter((e): e is (typeof events)[number] => !!e);
    return ordered.map((e) => ({
      id: e.id,
      title: e.title,
      slug: e.slug,
      shortDescription: e.shortDescription,
      startDate: e.startDate.toISOString(),
      endDate: e.endDate.toISOString(),
      images: e.images.length > 0 ? e.images : e.coverImage ? [e.coverImage] : [],
      isFeatured: e.isFeatured,
      minPrice: e.ticketTypes[0]?.price ?? null,
      maxPrice: e.ticketTypes.length > 0 ? e.ticketTypes[e.ticketTypes.length - 1].price : null,
      category: e.category,
      venue: e.venue,
      organizer: { id: e.organizer.id, organizationName: e.organizer.organizationName ?? 'EventAI' },
    }));
  }

  async chat(
    messages: AiChatInput['messages'],
  ): Promise<{ reply: string; events: AiEventCard[] }> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'The AI assistant is not configured on this server yet (missing GROQ_API_KEY).',
      );
    }

    const catalog = await this.loadCatalog();
    const catalogText =
      catalog.length > 0
        ? `\n\nUpcoming events you may recommend (do not invent others):\n${catalog
            .map(
              (e) =>
                `- ${e.title} | ${e.category} | ${new Date(e.startDate).toLocaleString('en-IN')} | ${e.city} | ${
                  e.minPrice !== null ? `from ₹${(e.minPrice / 100).toLocaleString('en-IN')}` : 'price TBD'
                } | /events/${e.slug}`,
            )
            .join('\n')}`
        : '\n\nThere are currently no upcoming events in the catalog.';

    const payload: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are EventAI, a friendly assistant for an event ticketing platform in India. ' +
          'Help users discover events, plan visits, and answer general event questions. ' +
          'Recommend only events from the catalog when asked for suggestions. ' +
          'Prices are in INR. Keep answers concise (under 150 words). If you do not know something, say so.' +
          catalogText +
          '\n\nFormatting rules: write conversational prose — bold event names with **, use simple dash lists, ' +
          'and keep it readable. Do NOT put event URLs, link paths, or price figures in the prose. ' +
          'When you recommend one or more catalog events, end your reply with exactly one final line in this format: ' +
          'EVENTS: <slug1>, <slug2> — using only slugs from the catalog above, comma-separated. ' +
          'If you recommend no events, omit the EVENTS line entirely. Never invent slugs.',
      },
      ...messages,
    ];

    // Bounded loop: at most one attempt per key, plus GROQ_TRANSIENT_RETRIES
    // transient retries — no unbounded retry loops.
    const maxAttempts = this.keyPool.size + GROQ_TRANSIENT_RETRIES;
    let transientRetries = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const key = this.keyPool.pick();
      if (!key) break;

      let response: Response;
      try {
        response = await this.callGroq(key, payload);
      } catch {
        // Network failure or timeout — transient. One bounded backoff retry
        // on the same key, then give up.
        if (transientRetries < GROQ_TRANSIENT_RETRIES) {
          transientRetries++;
          await new Promise((r) => setTimeout(r, GROQ_TRANSIENT_BACKOFF_MS));
          continue;
        }
        this.logger.warn('Groq request failed after retry');
        this.unavailable('The AI assistant is unreachable right now.');
      }

      if (response.status === 401 || response.status === 403) {
        // Invalid or revoked credential — cool the key down and rotate.
        this.logger.warn(`Groq credential rejected (HTTP ${response.status}); rotating keys.`);
        this.keyPool.markAuthFailed(key);
        continue;
      }

      if (response.status === 429) {
        // Shared org/account quota — respect Retry-After, do NOT rotate keys
        // (that would only shift the same 429 onto the next credential).
        const cooldownMs = parseRetryAfterMs(response.headers.get('retry-after'));
        this.keyPool.markRateLimited(key, cooldownMs);
        this.logger.warn(`Groq rate limited; backing off ${Math.round(cooldownMs / 1000)}s.`);
        this.unavailable(
          'The AI assistant is rate limited right now. Please retry shortly.',
          Math.ceil(cooldownMs / 1000),
        );
      }

      if (response.status >= 500 || response.status === 408) {
        if (transientRetries < GROQ_TRANSIENT_RETRIES) {
          transientRetries++;
          await new Promise((r) => setTimeout(r, GROQ_TRANSIENT_BACKOFF_MS));
          continue;
        }
        this.logger.warn(`Groq request failed (HTTP ${response.status})`);
        this.unavailable(
          'The AI assistant could not process this request. Please try again later.',
        );
      }

      if (!response.ok) {
        // Other 4xx (bad request, unknown model, …) — permanent for this
        // request shape; retrying would not help.
        this.logger.warn(`Groq request rejected (HTTP ${response.status})`);
        this.unavailable(
          'The AI assistant could not process this request. Please try again later.',
        );
      }

      const body = (await response.json()) as LlmCompletionResponse;
      const rawReply = body.choices?.[0]?.message?.content?.trim();
      if (!rawReply) {
        this.unavailable('The AI assistant returned an empty reply.');
      }
      const { reply, slugs } = this.extractRecommendedSlugs(rawReply);
      const events = await this.mapRecommendedEvents(slugs);
      return { reply, events };
    }

    // Every key is auth-failed or rate-limited — nothing left to try.
    const availableInMs = this.keyPool.availableInMs ?? 0;
    this.unavailable(
      'The AI assistant is temporarily unavailable (all API keys exhausted). Please retry shortly.',
      Math.ceil(availableInMs / 1000),
    );
  }
}
