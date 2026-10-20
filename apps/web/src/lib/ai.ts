'use client';
import { API_URL, type EventSummary } from './api';
import { getAccessToken } from './auth';
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  events?: EventSummary[];
  moreEventsUrl?: string;
  total?: number;
  searchFilters?: Record<string, unknown>;
}
export async function askEvents(
  messages: AiMessage[],
  eventId?: string,
  signal?: AbortSignal,
): Promise<{ reply: string; events: EventSummary[]; moreEventsUrl?: string; total?: number; searchFilters?: Record<string, unknown> }> {
  const token = getAccessToken();
  const timeout = AbortSignal.timeout(45000);
  const controller = new AbortController();
  const abort = () => controller.abort();
  timeout.addEventListener('abort', abort, { once: true });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    const res = await fetch(API_URL + '/ai/chat', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({
        // Keep the last applied preferences even after the transcript window moves on.
        ...(!eventId ? { discoveryContext: [...messages].reverse()
          .find(message => message.role === 'assistant' && message.searchFilters)?.searchFilters } : {}),
        messages: messages
          .slice(-12)
          .map(({ role, content, events }) => ({
            role,
            content: content.slice(0, 2000),
            ...(role === 'assistant' && events?.length
              ? { eventSlugs: events.slice(0, 6).map(event => event.slug) }
              : {}),
          })),
        ...(eventId ? { eventId } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retrySeconds = Number(data.retryAfterSeconds ?? res.headers.get('Retry-After'));
      const retryHint = retrySeconds > 0 ? ' Try again in ' + Math.ceil(retrySeconds) + ' seconds.' : '';
      throw new Error(res.status === 429
        ? 'You’ve reached the chat request limit.' + retryHint
        : typeof data.message === 'string' && /rate limit/i.test(data.message)
          ? 'The AI provider is temporarily at capacity.' + retryHint
          : (
        typeof data.message === 'string'
          ? data.message
          : 'The assistant is unavailable. Please try again.'
      ));
    }
    return {
      reply:
        typeof data.reply === 'string' ? data.reply : 'Here are the matching events.',
      events: Array.isArray(data.events) ? data.events.slice(0, 6) : [],
      moreEventsUrl: typeof data.moreEventsUrl === 'string' && data.moreEventsUrl.startsWith('/events?') ? data.moreEventsUrl : undefined,
      total: typeof data.total === 'number' ? data.total : undefined,
      searchFilters: data.searchFilters && typeof data.searchFilters === 'object' && !Array.isArray(data.searchFilters)
        ? data.searchFilters : undefined,
    };
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) throw new Error('The assistant took too long to respond. Please retry your message.');
    throw error;
  } finally {
    timeout.removeEventListener('abort', abort);
    signal?.removeEventListener('abort', abort);
  }
}
