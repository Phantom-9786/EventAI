'use client';
import { useEffect, useState } from 'react';
import { Conversation } from '@/components/ai/conversation';
export default function AiPage() {
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    setPrompt(
      new URLSearchParams(window.location.search).get('prompt')?.slice(0, 2000) || '',
    );
  }, []);
  return (
    <div className="wrap ep-ai-page">
      <Conversation initialPrompt={prompt} full autoSend />
    </div>
  );
}
