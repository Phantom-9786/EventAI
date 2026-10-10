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

  async chat(messages: AiChatInput['messages']): Promise<string> {
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
          'Recommend only events from the catalog when asked for suggestions, and mention the event link path. ' +
          'Prices are in INR. Keep answers concise (under 150 words). If you do not know something, say so.' +
          catalogText,
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
      } catch (error) {
        // Network failure or timeout — transient. One bounded backoff retry
        // on the same key, then give up.
        if (transientRetries < GROQ_TRANSIENT_RETRIES) {
          transientRetries++;
          await new Promise((r) => setTimeout(r, GROQ_TRANSIENT_BACKOFF_MS));
          continue;
        }
        this.logger.warn(
          `Groq request failed after retry: ${error instanceof Error ? error.message : 'unknown'}`,
        );
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
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        this.logger.warn(`Groq error ${response.status}: ${body.error?.message ?? 'unknown'}`);
        this.unavailable(
          'The AI assistant could not process this request. Please try again later.',
        );
      }

      if (!response.ok) {
        // Other 4xx (bad request, unknown model, …) — permanent for this
        // request shape; retrying would not help.
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        this.logger.warn(`Groq error ${response.status}: ${body.error?.message ?? 'unknown'}`);
        this.unavailable(
          'The AI assistant could not process this request. Please try again later.',
        );
      }

      const body = (await response.json()) as LlmCompletionResponse;
      const reply = body.choices?.[0]?.message?.content?.trim();
      if (!reply) {
        this.unavailable('The AI assistant returned an empty reply.');
      }
      return reply;
    }

    // Every key is auth-failed or rate-limited — nothing left to try.
    const availableInMs = this.keyPool.availableInMs ?? 0;
    this.unavailable(
      'The AI assistant is temporarily unavailable (all API keys exhausted). Please retry shortly.',
      Math.ceil(availableInMs / 1000),
    );
  }
}
