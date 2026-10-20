import { isMoodSearch } from './semantic-retrieval.service';

/** Only standalone social turns qualify; "thanks, show music" must still search. */
export function socialTurnReply(text: string): string | undefined {
  const normalized = text.normalize('NFKC').toLowerCase()
    .replace(/[’']/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  const gratitude = /^(?:(?:thank you|thanks|thankyou|thx|ty|shukriya|dhanyavaad|धन्यवाद|शुक्रिया)(?: so much| a lot| very much)?)(?: (?:bro|brother|bhai|yaar|buddy|for your help|for the help))?$/;
  if (gratitude.test(normalized)) return "You're welcome! Enjoy your plans.";
  if (/^(?:bye|goodbye|good bye|see you|see you later|good night)(?: bro| bhai| brother)?$/.test(normalized)) {
    return 'See you! Come back whenever you want to find your next experience.';
  }
  if (/^(?:hi|hello|hey|namaste|namaskar)(?: there| bro| brother| bhai| yaar)?$/.test(normalized)) {
    return 'Hey! What kind of experience are you looking for? You can share a mood, an interest, or ask to browse events.';
  }
  return undefined;
}

export function acceptsAnyCity(text: string): boolean {
  return /\b(any|all|every)\s+(?:cities|city|locations?|places?)\b|\banywhere\b|\bno\s+(?:city|location)\s+(?:preference|restriction)\b|\b(?:city|location)\s+(?:doesn't|does not|doesnt)\s+matter\b/i.test(text);
}

/** Preserve experiential intent when the next turn only relaxes a constraint. */
export function moodContext(messages: { role: string; content: string }[]): string | undefined {
  return messages.filter(m => m.role === 'user').slice(-6).reverse()
    .find(m => isMoodSearch(m.content))?.content.slice(0, 500);
}

/** Distill a missing model filter from the requested experience, not work/group logistics. */
export function moodQuery(text: string): string {
  const preference = text.split(/\b(?:want(?:ing)?|looking for|prefer|need)\b/i).pop() ?? text;
  const concise = preference.trim().replace(/^(?:(?:to|have|some|a|an)\s+)+/i, '').trim();
  return (concise + (/\brelax(?:ed|ing)?\b/i.test(concise) ? ' calm peaceful unwind' : '')).slice(0, 500);
}

export function normalizeDiscoveryFilter(
  input: Record<string, unknown>,
  messages: { role: string; content: string }[],
  reset: boolean,
): Record<string, unknown> {
  const normalized = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== ''));
  const users = messages.filter(m => m.role === 'user').slice(-6);
  const latest = users[users.length - 1]?.content ?? '';
  if (acceptsAnyCity(latest) || (typeof normalized.city === 'string' && /^(any(?: city)?|all(?: cities)?|anywhere|none|no preference)$/i.test(normalized.city.trim()))) delete normalized.city;
  const mood = reset ? undefined : moodContext(messages);
  if (mood) {
    const context = users.map(m => m.content).join('\n');
    // "Free to choose a city" is flexibility, not a request for zero-price tickets.
    const hasBudget = /₹|\b(?:budget|price|cost|spend|afford|pay|rupees|inr|rs\.?|under\s+\d|below\s+\d|free\s+(?:events?|entry|tickets?|passes))\b|\b\d[\d,]*\s*(?:each|per person)\b/i.test(context);
    if (!hasBudget) { delete normalized.priceMin; delete normalized.priceMax; }
    const hasDate = /\b(?:today|tomorrow|tonight|weekend|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|(?:this|next)\s+(?:week|month|year))\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/-]\d{1,2}\b/i.test(context);
    if (!hasDate || /\bany\s+dates?\b|\banytime\b/i.test(latest)) { delete normalized.dateFrom; delete normalized.dateTo; }
    normalized.semanticQuery = moodQuery(typeof normalized.semanticQuery === 'string' ? normalized.semanticQuery : mood);
    // Atmosphere belongs in semantic matching, not a second mandatory FTS filter.
    if (typeof normalized.query === 'string' && /^(?:(?:chill|calm|seated|relax(?:ed|ing)?|quiet|peaceful|evening|vibes?|mood|friends?|OR|and)\s*)+$/i.test(normalized.query)) delete normalized.query;
    if (normalized.partySize === undefined) {
      const numberWords: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
      for (const message of messages.filter(m => m.role === 'user').slice(-6).reverse()) {
        const group = message.content.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:friends|people|persons|bande)\b/i);
        if (group) { normalized.partySize = numberWords[group[1].toLowerCase()] ?? Number(group[1]); break; }
      }
    }
  } else delete normalized.semanticQuery;
  for (const key of ['dateFrom', 'dateTo']) {
    const value = normalized[key];
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) normalized[key] = value + (key === 'dateTo' ? 'T23:59:59.999Z' : 'T00:00:00.000Z');
  }
  return normalized;
}
