'use client';
import { useCallback, useEffect, useState } from 'react';
import { Conversation } from '@/components/ai/conversation';
export default function AiPage() {
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    setPrompt(
      new URLSearchParams(window.location.search).get('prompt')?.slice(0, 2000) || '',
    );
  }, []);
  const consumePrompt = useCallback(() => {
    // This history entry must restore the conversation, not submit it again.
    const url = new URL(window.location.href);
    url.searchParams.delete('prompt');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    setPrompt('');
  }, []);
  return (
    <div className="wrap ep-ai-page">
      <Conversation initialPrompt={prompt} full autoSend onInitialPromptConsumed={consumePrompt} />
    </div>
  );
}
