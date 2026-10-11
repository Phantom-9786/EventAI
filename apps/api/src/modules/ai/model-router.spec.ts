import { classifyAiComplexity, resolveModelProfiles, nextCapableModel } from './model-router';

describe('AI model router', () => {
  it.each([
    ['Hello', 'simple'],
    ['Where is the concert?', 'simple'],
    ['Compare these events and recommend the best one', 'moderate'],
    ['Create a detailed step-by-step plan with alternatives', 'complex'],
    ['Tell me about upcoming events', 'moderate'],
  ] as const)('classifies "%s" as %s', (prompt, expected) => {
    expect(classifyAiComplexity(prompt)).toBe(expected);
  });

  it('uses configurable profiles with legacy GROQ_MODEL as the middle/complex fallback', () => {
    expect(resolveModelProfiles({ GROQ_MODEL: 'org/model-x' } as NodeJS.ProcessEnv)).toEqual({
      simple: 'openai/gpt-oss-20b',
      moderate: 'org/model-x',
      complex: 'org/model-x',
    });
  });

  it('rejects malformed model identifiers and bounds escalation to a stronger configured profile', () => {
    expect(() => resolveModelProfiles({ GROQ_SIMPLE_MODEL: 'bad model' } as NodeJS.ProcessEnv)).toThrow(
      'Invalid Groq model ID configured for simple requests',
    );
    const profiles = {
      simple: 'model-a',
      moderate: 'model-b',
      complex: 'model-c',
    };
    expect(nextCapableModel('simple', profiles, 'model-a')).toBe('model-b');
    expect(nextCapableModel('moderate', profiles, 'model-b')).toBe('model-c');
    expect(nextCapableModel('complex', profiles, 'model-c')).toBeNull();
  });
});
