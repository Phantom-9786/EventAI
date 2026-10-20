export interface ContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface EvidenceChunk {
  id: string;
  eventSlug: string;
  section: string;
  text: string;
}

/** Bound recent history without cutting the current user's message. Older
 * preferences are supplied separately as the model-maintained compact memory. */
export function recentConversation(messages: ContextMessage[]): ContextMessage[] {
  const recent = messages.slice(-6);
  let remaining = 6_000;
  const kept: ContextMessage[] = [];
  for (let index = recent.length - 1; index >= 0; index--) {
    const message = recent[index];
    const limit = Math.min(remaining, index === recent.length - 1 ? 2000 : 1000);
    if (limit < 1) break;
    const content = message.content.slice(0, limit);
    kept.unshift({ role: message.role, content });
    remaining -= content.length;
  }
  return kept;
}

/** Preserve section and event identity with every passage. Overlap protects
 * facts split near a chunk boundary; avoid splitting a word where possible. */
export function eventChunks(eventSlug: string, title: string, section: string, text: string | null | undefined): EvidenceChunk[] {
  const clean = (text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const chunks: EvidenceChunk[] = [];
  for (let start = 0; start < clean.length;) {
    let end = Math.min(start + 600, clean.length);
    if (end < clean.length) {
      const space = clean.lastIndexOf(' ', end);
      if (space > start + 400) end = space;
    }
    chunks.push({ id: `${eventSlug}:${section}:${start}`, eventSlug, section,
      text: `${title.slice(0, 180)} | ${section}: ${clean.slice(start, end)}` });
    if (end === clean.length) break;
    start = Math.max(start + 1, end - 80);
  }
  return chunks;
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** BM25 lexical scores complement vector similarity for precise policy/FAQ terms. */
export function lexicalChunkScores(query: string, chunks: EvidenceChunk[]): number[] {
  const documents = chunks.map(chunk => tokens(chunk.text));
  const averageLength = documents.reduce((sum, words) => sum + words.length, 0) / (documents.length || 1);
  const terms = [...new Set(tokens(query))];
  const documentFrequencies = new Map(terms.map(term => [term, documents.filter(document => document.includes(term)).length]));
  return documents.map(words => terms.reduce((score, term) => {
    const frequency = words.filter(word => word === term).length;
    if (!frequency) return score;
    const documentFrequency = documentFrequencies.get(term) ?? 0;
    const inverseFrequency = Math.log(1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5));
    return score + inverseFrequency * frequency * 2.2 /
      (frequency + 1.2 * (0.25 + 0.75 * words.length / (averageLength || 1)));
  }, 0));
}

/** A shared evidence budget, with at least one passage per requested event for
 * comparisons. Selection never silently takes all facts from just one event. */
export function selectEvidence(chunks: EvidenceChunk[], scores: number[], limit = 6): EvidenceChunk[] {
  const ranked = chunks.map((chunk, index) => ({ chunk, score: scores[index] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const selected: EvidenceChunk[] = [];
  for (const slug of [...new Set(chunks.map(chunk => chunk.eventSlug))]) {
    const best = ranked.find(row => row.chunk.eventSlug === slug);
    if (best && selected.length < limit) selected.push(best.chunk);
  }
  for (const row of ranked) {
    if (selected.length >= limit) break;
    if (!selected.some(chunk => chunk.id === row.chunk.id)) selected.push(row.chunk);
  }
  return selected;
}
