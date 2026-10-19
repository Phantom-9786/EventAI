export interface SearchCategory {
  name: string;
  slug: string;
}
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
function close(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length === b.length && a.length >= 5) {
    const different = [...a]
      .map((letter, i) => (letter === b[i] ? -1 : i))
      .filter((i) => i >= 0);
    if (
      different.length === 2 &&
      different[1] === different[0] + 1 &&
      a[different[0]] === b[different[1]] &&
      a[different[1]] === b[different[0]]
    )
      return true;
  }
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = old;
    }
  }
  return row[b.length] <= 1;
}
export function homeSearchDestination(
  query: string,
  categories: SearchCategory[],
  city = '',
): string {
  const simple = normalize(query)
    .replace(/\b(events?|shows?|category|categories|please|browse|find)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const aliases: Record<string, string[]> = {
    music: ['concert', 'concerts', 'gig', 'gigs'],
    technology: ['tech', 'developer', 'coding'],
    comedy: ['standup', 'stand up'],
    'food-and-drink': ['food', 'dining', 'food and drink'],
    'arts-and-theatre': ['art', 'arts', 'theatre', 'theater'],
    'health-and-wellness': ['wellness', 'yoga'],
    sports: ['sport'],
    business: ['networking'],
  };
  const matches = categories.filter((c) =>
    [normalize(c.name), normalize(c.slug), ...(aliases[c.slug] || [])].some((v) =>
      close(simple, v),
    ),
  );
  if (matches.length === 1) {
    const p = new URLSearchParams({ category: matches[0].slug });
    if (city) p.set('city', city);
    return '/events?' + p;
  }
  const prompt = (city ? 'In ' + city + ': ' : '') + query.trim();
  return '/ai?' + new URLSearchParams({ prompt });
}
