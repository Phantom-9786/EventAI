'use client';
import { useEffect, useRef, useState } from 'react';
import { Bot, Send, Sparkles } from 'lucide-react';
import { Conversation } from '@/components/ai/conversation';
export function EventAiWidget({
  eventId,
  eventTitle,
  eventCity,
}: {
  eventId: string;
  eventTitle: string;
  eventCity: string;
}) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [question, setQuestion] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  function ask(value: string) {
    if (!value.trim()) return;
    setPrompt(value.trim());
    setOpen(true);
  }
  return (
    <>
      <section className="question-box ep-event-assistant">
        <div className="ep-actions">
          <Bot className="icon" />
          <h3>EventPoint assistant</h3>
        </div>
        <p>Ask about this event while keeping the event page open.</p>
        <div className="ep-event-prompts">
          {[
            'What are the ticket options?',
            'What is the cancellation policy?',
            'How do I reach the venue in ' + eventCity + '?',
          ].map((q) => (
            <button type="button" key={q} onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="ep-inline-ask"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <Sparkles className="icon" />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={2000}
            placeholder="Ask about this event…"
            aria-label="Ask about this event"
          />
          <button
            ref={trigger}
            type="submit"
            className="icon-btn"
            disabled={!question.trim()}
            aria-label="Send event question"
          >
            <Send className="icon" />
          </button>
        </form>
      </section>
      {open && (
        <aside className="ep-event-chat-dock" aria-label="Event chat panel">
          <Conversation
            eventId={eventId}
            eventTitle={eventTitle}
            initialPrompt={prompt}
            autoSend
            onClose={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
          />
        </aside>
      )}
    </>
  );
}
