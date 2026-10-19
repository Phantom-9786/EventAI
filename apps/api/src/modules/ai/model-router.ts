export type AiComplexity = 'simple' | 'moderate' | 'complex';

const COMPLEX_PATTERNS = [
  /\b(step[- ]by[- ]step|multi[- ]step|comprehensive|detailed itinerary|contingency|optimi[sz]e|trade[- ]off|constraints?)\b/i,
  /\b(plan|design|organize|build)\b.{0,100}\b(?:\d+|multiple|several|different)\b/i,
  /\b(?:if .* then|compare .* and .* and|across .* venues?)\b/i,
];
const MODERATE_PATTERNS = [
  /\b(compare|comparison|recommend|recommendation|suggest|best|which|versus|vs\.?|alternatives?)\b/i,
  /\b(events?|venues?)\b.{0,80}\b(?:and|or|vs\.?|versus|compare)\b/i,
];
const SIMPLE_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|good morning|good evening|what can you do)[.!?\s]*$/i,
  /\b(when|where|how much|what time|who is performing|is .* available)\b/i,
];

/** Deterministic, local-only classification of the latest user message. */
export function classifyAiComplexity(text: string): AiComplexity {
  const message = text.trim();
  const constraints = [
    /\b(budget|under|below|rupees|rs|₹)\b/i,
    /\b(friends?|people|group|bande|persons?)\b/i,
    /\b(chill|relax|quiet|calm|mood|vibe|dance)\b/i,
    /\b(today|tomorrow|weekend|date|free|january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\b(not|avoid|without|dont|don't)\b/i,
  ].filter((pattern) => pattern.test(message)).length;
  if (constraints >= 3 || message.length > 450) return 'complex';
  if (/^(?:music|sports|technology|comedy|business|food|arts|wellness)(?: events)?[.!?\s]*$/i.test(message)) return 'simple';
  if (COMPLEX_PATTERNS.some((pattern) => pattern.test(message))) return 'complex';
  if (MODERATE_PATTERNS.some((pattern) => pattern.test(message))) return 'moderate';
  if (SIMPLE_PATTERNS.some((pattern) => pattern.test(message))) return 'simple';
  // Ambiguous prompts are routed to the middle profile without another model call.
  return 'moderate';
}

export function resolveModelProfiles(env: NodeJS.ProcessEnv = process.env) {
  const fallback = env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';
  const profiles = {
    simple: env.GROQ_SIMPLE_MODEL?.trim() || 'openai/gpt-oss-20b',
    moderate: env.GROQ_MODERATE_MODEL?.trim() || fallback,
    complex: env.GROQ_COMPLEX_MODEL?.trim() || fallback,
  };
  for (const [tier, model] of Object.entries(profiles)) {
    if (!/^[a-z0-9][a-z0-9._/-]{1,127}$/i.test(model)) {
      throw new Error(`Invalid Groq model ID configured for ${tier} requests`);
    }
  }
  return profiles;
}

export function nextCapableModel(
  complexity: AiComplexity,
  profiles: ReturnType<typeof resolveModelProfiles>,
  current: string,
): string | null {
  const order: AiComplexity[] = complexity === 'simple'
    ? ['moderate', 'complex']
    : complexity === 'moderate'
      ? ['complex']
      : [];
  return order.map((tier) => profiles[tier]).find((model) => model !== current) ?? null;
}
