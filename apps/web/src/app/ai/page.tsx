'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function AiPage() {
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
      const body = (await res.json().catch(() => ({}))) as { reply?: string; message?: string };
      if (!res.ok) {
        setError(body.message ?? 'The assistant is unavailable right now.');
      } else {
        setMessages((m) => [...m, { role: 'assistant', content: body.reply ?? '…' }]);
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
        className="mt-6 flex max-h-[55vh] min-h-[320px] flex-col gap-3 overflow-y-auto rounded-lg border bg-card p-4"
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === 'user'
                ? 'self-end rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground'
                : 'self-start rounded-2xl rounded-bl-sm bg-muted px-4 py-2 text-sm'
            }
          >
            {m.content}
          </div>
        ))}
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

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. What can I do in Mumbai this weekend under ₹2000?"
          aria-label="Message the assistant"
          className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" disabled={sending || !input.trim()}>
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
