'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { Loader2, Send, Sparkles, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EventCard } from '@/components/events/event-card';
import { useSystemControls } from '@/components/layout/maintenance-guard';
import type { EventSummary } from '@/lib/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  events?: EventSummary[];
}

/** Safe Markdown styling for assistant prose (bold, lists, links only). */
const markdownComponents = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-1.5 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-1.5 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-1.5 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline">
      {children}
    </a>
  ),
};

export default function AiPage() {
  const { controls } = useSystemControls();
  const isMaintenance = Boolean(controls?.aiMaintenance);
  const maintenanceMessage =
    controls?.aiMaintenanceMessage ||
    'AI Assistant is temporarily unavailable for maintenance. Please try again later.';

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        'Hi! I am EventAI. Ask me what to do this weekend, which events suit your budget, or anything about planning your next outing.',
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setError(null);
    setSending(true);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .slice(-12),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        reply?: string;
        events?: EventSummary[];
        message?: string;
      };
      if (!res.ok) {
        setError(body.message ?? 'The assistant is unavailable right now.');
      } else {
        setMessages((m) => [
          ...m,
          {
            role: 'assistant',
            content: body.reply ?? '…',
            events: Array.isArray(body.events) ? body.events : [],
          },
        ]);
      }
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setSending(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  }

  return (
    <div className="container flex max-w-2xl flex-col py-10">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">EventAI Assistant</h1>
          <p className="text-xs text-muted-foreground">
            Grounded in our live catalog — it never invents events.
          </p>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="mt-6 flex max-h-[70vh] min-h-[320px] flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-4"
      >
        {messages.map((m, i) =>
          m.role === 'user' ? (
            <div
              key={i}
              className="self-end rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              {m.content}
            </div>
          ) : (
            <div key={i} className="flex max-w-full flex-col gap-3 self-stretch">
              <div className="self-start rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm">
                <ReactMarkdown components={markdownComponents}>{m.content}</ReactMarkdown>
              </div>
              {m.events && m.events.length > 0 && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {m.events.map((event) => (
                    <EventCard key={event.id} event={event} showDescription />
                  ))}
                </div>
              )}
            </div>
          ),
        )}
        {sending && (
          <div className="self-start rounded-2xl bg-muted px-4 py-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}{' '}
          {error.includes('not configured') && (
            <span className="text-muted-foreground">
              The operator needs to set a <code>GROQ_API_KEY</code> on the API server.
            </span>
          )}
        </p>
      )}

      {isMaintenance && (
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-300 flex items-start gap-3">
          <Wrench className="h-5 w-5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold">AI Assistant Offline</p>
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-300/80 leading-relaxed">
              {maintenanceMessage}
            </p>
          </div>
        </div>
      )}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (isMaintenance) return;
          void send(input);
        }}
      >
        <input
          value={input}
          disabled={isMaintenance}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            isMaintenance
              ? 'AI Assistant is temporarily unavailable for maintenance'
              : 'e.g. What can I do in Mumbai this weekend under ₹2000?'
          }
          aria-label="Message the assistant"
          className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <Button type="submit" disabled={isMaintenance || sending || !input.trim()}>
          <Send className="mr-1 h-4 w-4" />
          Send
        </Button>
      </form>

      <p className="mt-4 text-center text-xs text-muted-foreground">
        Not sure where to start?{' '}
        <Link href="/events" className="text-primary hover:underline">
          Browse all events
        </Link>
      </p>
    </div>
  );
}
