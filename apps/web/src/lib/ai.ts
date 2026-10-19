'use client';
import { API_URL, type EventSummary } from './api';
import { getAccessToken } from './auth';
export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  events?: EventSummary[];
  moreEventsUrl?: string;
  total?: number;
}
export async function askEvents(
  messages: AiMessage[],
  eventId?: string,
  signal?: AbortSignal,
): Promise<{ reply: string; events: EventSummary[]; moreEventsUrl?: string; total?: number }> {
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
        messages: messages
          .slice(-12)
          .map(({ role, content }) => ({ role, content: content.slice(0, 2000) })),
        ...(eventId ? { eventId } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        typeof data.message === 'string'
          ? data.message
          : 'The assistant is unavailable. Please try again.',
      );
    return {
      reply:
        typeof data.reply === 'string' ? data.reply : 'Here are the matching events.',
      events: Array.isArray(data.events) ? data.events.slice(0, 6) : [],
      moreEventsUrl: typeof data.moreEventsUrl === 'string' && data.moreEventsUrl.startsWith('/events?') ? data.moreEventsUrl : undefined,
      total: typeof data.total === 'number' ? data.total : undefined,
    };
  } finally {
    timeout.removeEventListener('abort', abort);
    signal?.removeEventListener('abort', abort);
  }
}
