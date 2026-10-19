'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, Send, Bot, Music, Code, Utensils, Smile, Compass } from 'lucide-react';

const SUGGESTED_PROMPTS = [
  { icon: Music, label: 'Live music this weekend', query: 'Show me live music events this weekend' },
  { icon: Code, label: 'Tech events under ₹1,000', query: 'Tech conferences and workshops under 1000 INR' },
  { icon: Utensils, label: 'Food festivals in Bengaluru', query: 'Food festivals and culinary experiences in Bengaluru' },
  { icon: Smile, label: 'Comedy shows nearby', query: 'Standup comedy nights and live comedy shows' },
  { icon: Compass, label: 'Surprise me with something fun!', query: 'Surprise me with popular upcoming events' },
];

export function AiConciergeCard() {
  const router = useRouter();
  const [inputQuery, setInputQuery] = useState('');

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputQuery.trim()) return;
    router.push(`/ai?prompt=${encodeURIComponent(inputQuery.trim())}`);
  };

  const handlePromptClick = (promptQuery: string) => {
    router.push(`/ai?prompt=${encodeURIComponent(promptQuery)}`);
  };

  return (
    <div className="relative overflow-hidden rounded-3xl border border-indigo-500/20 bg-gradient-to-br from-card via-card/95 to-indigo-950/20 p-6 sm:p-8 shadow-md">
      {/* Subtle ambient light */}
      <div className="absolute -right-20 -top-20 -z-10 h-64 w-64 rounded-full bg-indigo-500/10 blur-3xl" />
      <div className="absolute -left-20 -bottom-20 -z-10 h-64 w-64 rounded-full bg-purple-500/10 blur-3xl" />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Left column: Bot Avatar + Prompt */}
        <div className="flex items-start gap-4">
          <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-500/25">
            <Bot className="h-7 w-7" />
            <span className="absolute -right-1 -top-1 flex h-4 w-4">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-4 w-4 rounded-full bg-emerald-500 border-2 border-card" />
            </span>
          </div>

          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              <Sparkles className="h-3 w-3" /> EventPoint AI
            </div>
            <h2 className="mt-1 text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Not sure what to do?
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground max-w-xl leading-relaxed">
              Tell us your mood, city, or interests. Our catalog-grounded AI assistant will curate recommendations for you in real time.
            </p>
          </div>
        </div>

        {/* Right column: Quick Suggestion Chips */}
        <div className="flex flex-wrap items-center gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt.label}
              type="button"
              onClick={() => handlePromptClick(prompt.query)}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/80 px-3.5 py-1.5 text-xs font-semibold text-foreground transition-all duration-150 hover:border-indigo-500/40 hover:bg-accent hover:text-indigo-600 dark:hover:text-indigo-400 active:scale-95 shadow-sm"
            >
              <prompt.icon className="h-3.5 w-3.5 text-indigo-500" />
              <span>{prompt.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Inline Search / Prompt Input Bar */}
      <form onSubmit={handleSubmit} className="mt-6">
        <div className="relative flex items-center rounded-2xl border border-border/80 bg-background/90 p-1.5 shadow-sm focus-within:border-indigo-500/50 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
          <Sparkles className="ml-3 h-5 w-5 text-indigo-500 shrink-0" />
          <input
            type="text"
            value={inputQuery}
            onChange={(e) => setInputQuery(e.target.value)}
            placeholder="Ask EventPoint anything... (e.g. 'Best music festivals in November with tickets under ₹2,000')"
            className="w-full bg-transparent px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!inputQuery.trim()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md transition-all duration-150 hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            aria-label="Send query to EventPoint AI"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
