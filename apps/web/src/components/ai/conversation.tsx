'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/auth-provider';
import ReactMarkdown from 'react-markdown';
import {
  Bot,
  Send,
  RotateCcw,
  Sparkles,
  X,
  Maximize2,
  Minimize2,
  Compass,
} from 'lucide-react';
import { askEvents, type AiMessage } from '@/lib/ai';
import { API_URL } from '@/lib/api';
import { AiEventCard } from './event-card';
import { useSystemControls } from '@/components/layout/maintenance-guard';
export function Conversation({
  eventId,
  eventTitle,
  initialPrompt = '',
  full = false,
  onClose,
  autoSend = false,
  onInitialPromptConsumed,
}: {
  eventId?: string;
  eventTitle?: string;
  initialPrompt?: string;
  full?: boolean;
  onClose?: () => void;
  autoSend?: boolean;
  onInitialPromptConsumed?: () => void;
}) {
  const greeting: AiMessage = {
    role: 'assistant',
    content: eventTitle
      ? 'Hello! How can I help you with this event? Ask about tickets, the venue, or booking policies.'
      : 'Tell me your city, budget, dates or interests. I’ll find matching events for you.',
  };
  const { user, loading: authLoading } = useAuth();
  const storageKey = full && !eventId ? 'eventpoint-ai-chat-v1:' + (user?.id ?? 'guest') : null;
  const [restoredKey, setRestoredKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiMessage[]>([greeting]);
  const [input, setInput] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [resetRevision, setResetRevision] = useState(0);
  const root = useRef<HTMLElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const initialSent = useRef('');
  const area = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const active = useRef<AbortController | null>(null);
  const serial = useRef(0);
  const { controls } = useSystemControls();
  const maintenance = Boolean(controls?.aiMaintenance);
  useEffect(() => {
    if (!storageKey || authLoading) return;
    let restored: AiMessage[] = [greeting];
    let draft = '';
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      if (Array.isArray(saved?.messages)) {
        const valid = saved.messages.filter((m: AiMessage) =>
          m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
        ).slice(-60);
        if (valid.length) restored = valid;
      }
      if (typeof saved?.draft === 'string') draft = saved.draft.slice(0, 2000);
    } catch { /* Storage may be disabled or stale. */ }
    setMessages(restored);
    setInput(draft);
    setRestoredKey(storageKey);
  }, [storageKey, authLoading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!storageKey || restoredKey !== storageKey || authLoading) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ messages: messages.slice(-60), draft: input })); } catch { /* Chat still works without browser storage. */ }
  }, [messages, input, storageKey, restoredKey, authLoading]);
  useEffect(() => {
    if (initialPrompt) {
      setInput(initialPrompt);
      inputRef.current?.focus();
    }
  }, [initialPrompt]);
  useEffect(() => {
    area.current?.scrollTo({ top: area.current.scrollHeight, behavior: 'auto' });
  }, [messages, busy]);
  useEffect(
    () => () => {
      serial.current++;
      active.current?.abort();
    },
    [],
  );
  async function send(value: string) {
    const text = value.trim();
    if (!text || active.current || maintenance) return;
    const controller = new AbortController();
    active.current = controller;
    const request = ++serial.current;
    // Retry an unanswered message without duplicating it in the transcript.
    const last = messages[messages.length - 1];
    const next = last?.role === 'user' && last.content === text
      ? messages : [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setError('');
    setBusy(true);
    try {
      const reply = await askEvents(next, eventId, controller.signal);
      if (serial.current === request)
        setMessages([
          ...next,
          { role: 'assistant', content: reply.reply, events: reply.events, moreEventsUrl: reply.moreEventsUrl, total: reply.total },
        ]);
    } catch (err) {
      if (serial.current === request && !controller.signal.aborted)
        setError(
          err instanceof Error ? err.message : 'Could not connect. Please try again.',
        );
    } finally {
      if (serial.current === request) {
        active.current = null;
        setBusy(false);
        inputRef.current?.focus();
      }
    }
  }
  useEffect(() => {
    if (!autoSend || !initialPrompt || maintenance || authLoading) return;
    // Wait for the saved transcript before appending the homepage request.
    if (storageKey && restoredKey !== storageKey) return;
    const timer = setTimeout(() => {
      if (initialSent.current !== initialPrompt && !active.current) {
        initialSent.current = initialPrompt;
        void send(initialPrompt);
        onInitialPromptConsumed?.();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [autoSend, initialPrompt, maintenance, authLoading, storageKey, restoredKey, onInitialPromptConsumed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    inputRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        setExpanded(false);
        expandButton.current?.focus();
      }
      if (e.key === 'Tab') {
        const nodes = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),textarea:not(:disabled),a[href]',
          ) || [],
        ).filter((n) => n.getClientRects().length);
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', key, true);
    };
  }, [expanded]);
  const [ideas, setIdeas] = useState<
    { title: string; prompt: string; icon: typeof Compass }[]
  >([]);
  useEffect(() => {
    if (!full) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    fetch(API_URL + '/ai/suggestions', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!controller.signal.aborted && Array.isArray(data?.suggestions))
          setIdeas(
            data.suggestions
              .slice(0, 4)
              .filter(
                (item: { title?: unknown; prompt?: unknown }) =>
                  typeof item.title === 'string' && typeof item.prompt === 'string',
              )
              .map((item: { title: string; prompt: string }) => ({
                ...item,
                icon: Compass,
              })),
          );
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [full]);
  const chips = eventTitle
    ? [
        'What should I know before booking?',
        'Explain the ticket options',
        'What is the cancellation policy?',
      ]
    : [];
  return (
    <section
      ref={root}
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      className={
        'ep-conversation ' +
        (full ? 'ep-conversation-full' : 'ep-conversation-event') +
        (expanded ? ' ep-chat-expanded' : '')
      }
      aria-label={eventTitle ? 'Chat about this event' : 'EventPoint AI assistant'}
    >
      <div className="ep-chat-heading">
        <span className="ep-chat-mark">
          <Bot className="icon" />
        </span>
        <div>
          {full ? <h1>EventPoint AI</h1> : <h2>Event assistant</h2>}
          {eventTitle && <p>{eventTitle}</p>}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="New chat"
          title="Reset chat"
          onClick={() => {
            setResetRevision((n) => n + 1);
            serial.current++;
            active.current?.abort();
            active.current = null;
            setBusy(false);
            setMessages([greeting]);
            setError('');
            setInput('');
            inputRef.current?.focus();
          }}
        >
          <RotateCcw
            key={resetRevision}
            className={'icon' + (resetRevision ? ' ep-reset-spinning' : '')}
          />
        </button>
        {!full && (
          <button
            ref={expandButton}
            type="button"
            className="icon-btn"
            aria-label={expanded ? 'Minimize chat' : 'Expand chat'}
            title={expanded ? 'Minimize chat' : 'Expand chat'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <Minimize2 className="icon" /> : <Maximize2 className="icon" />}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            aria-label="Close event chat"
          >
            <X className="icon" />
          </button>
        )}
      </div>
      <div className="ep-chat-suggestions">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            disabled={busy || maintenance}
            onClick={() => void send(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div className={'ep-chat-body' + (ideas.length ? '' : ' ep-chat-no-ideas')}>
        <div
          ref={area}
          className={'ep-chat-messages ' + (messages.length === 1 ? 'ep-chat-empty' : '')}
          role="log"
          aria-label="Conversation"
          aria-live="polite"
        >
          {full && messages.length === 1 && (
            <div className="ep-ai-welcome">
              <span className="ep-chat-mark">
                <Sparkles className="icon" />
              </span>
              <h2>Let’s find your next good plan.</h2>
              <p>Describe what you have in mind, or try a suggested question.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div
              className={
                'ep-chat-message ' + m.role + (m.events?.length ? ' has-events' : '')
              }
              key={i}
            >
              <span className="ep-message-label">
                {m.role === 'user' ? 'You' : 'EventPoint'}
              </span>
              <div className="ep-chat-bubble">
                <ReactMarkdown>{m.content}</ReactMarkdown>
              </div>
              {Boolean(m.events?.length) && (
                <div className="ep-chat-results">
                  {m.events!.slice(0, 6).map((e) => (
                    <AiEventCard key={e.id} event={e} />
                  ))}
                </div>
              )}
              {m.moreEventsUrl?.startsWith('/events?') && (m.total ?? 0) > Math.min(m.events?.length ?? 0, 6) && (
                <Link className="ep-chat-more" href={m.moreEventsUrl}>
                  More related events →
                </Link>
              )}
            </div>
          ))}
          {busy && (
            <p role="status" className="ep-chat-working">
              <Sparkles className="icon" /> Finding the right answer…
            </p>
          )}
        </div>
        {(full || expanded) && ideas.length > 0 && (
          <aside className="ep-ai-ideas" aria-label="Explore with AI">
            <span className="small-label">A little inspiration</span>
            <h2>Suggested for you to ask</h2>
            <p>Ideas from the current event catalog.</p>
            {ideas.map(({ icon: Icon, title, prompt }) => (
              <button
                key={title}
                type="button"
                disabled={busy || maintenance}
                onClick={() => void send(prompt)}
              >
                <span className="ep-idea-icon">
                  <Icon className="icon" />
                </span>
                <span>
                  <strong>
                    {title === 'Upcoming events'
                      ? 'What’s coming up?'
                      : title === 'Popular tickets'
                        ? 'What’s popular right now?'
                        : 'Find ' + title.toLowerCase() + ' events'}
                  </strong>
                  <small>Ask EventPoint AI →</small>
                </span>
              </button>
            ))}
            <div className="ep-ai-hint">
              <Sparkles className="icon" />
              <p>Add your city, dates and budget for more useful matches.</p>
            </div>
          </aside>
        )}
      </div>
      {(error || maintenance) && (
        <div className="ep-chat-error" role="alert">
          {maintenance
            ? controls?.aiMaintenanceMessage ||
              'The assistant is temporarily under maintenance.'
            : error}
        </div>
      )}
      <form
        className="ep-chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          maxLength={2000}
          aria-label="Ask the EventPoint AI"
          placeholder={
            eventTitle ? 'Ask about this event…' : 'Describe your ideal event…'
          }
          value={input}
          disabled={busy || maintenance}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button
          className="btn"
          type="submit"
          disabled={busy || maintenance || !input.trim()}
          aria-label="Send message"
        >
          <Send className="icon" />
        </button>
      </form>
    </section>
  );
}
