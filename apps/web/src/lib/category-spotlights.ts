const copy: Record<string, { eyebrow: string; title: string; description: string }> = {
  music: { eyebrow: 'Find your sound', title: 'Music. Better together.', description: 'Small rooms, big stages, and everything in between.' },
  'health-and-wellness': { eyebrow: 'Make time for yourself', title: 'Breathe. Reset. Begin.', description: 'A little space to unwind and feel good.' },
  'arts-and-theatre': { eyebrow: 'A different perspective', title: 'See where creativity takes you.', description: 'Art, stories, and moments that stay with you.' },
  'food-and-drink': { eyebrow: 'Something worth sharing', title: 'Good food. Great company.', description: 'Discover new flavours and gather around something good.' },
  technology: { eyebrow: 'Ideas for what comes next', title: 'Get curious. Build something.', description: 'Meet new ideas and the people bringing them to life.' },
  business: { eyebrow: 'Make your next connection', title: 'Good ideas start together.', description: 'Conversations, connections, and fresh possibilities.' },
  comedy: { eyebrow: 'Leave the week behind', title: 'Make room for a good laugh.', description: 'Find a show and share a lighter evening.' },
  sports: { eyebrow: 'Get into the moment', title: 'Bring your game-day energy.', description: 'A little action, a little competition, a lot to cheer for.' },
};

// Reuse established public imagery; no uploads or model calls per page visit.
const crowd = 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=85';
const conference = 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=900&q=85';
const covers: Record<string, string> = {
  music: crowd,
  comedy: crowd,
  sports: crowd,
  business: conference,
  technology: conference,
  'health-and-wellness': 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&w=900&q=85',
  'arts-and-theatre': 'https://images.unsplash.com/photo-1536924940846-227afb31e2a5?auto=format&fit=crop&w=900&q=85',
  'food-and-drink': 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=900&q=85',
};

export function categorySpotlightCover(category: { slug: string; coverImage: string | null }) {
  return covers[category.slug] ?? category.coverImage;
}

export function categorySpotlightCopy(category: { name: string; slug: string }) {
  return copy[category.slug] ?? {
    eyebrow: 'Try a change of pace',
    title: 'Discover ' + category.name.toLowerCase() + '.',
    description: 'Find your next experience and make a plan worth sharing.',
  };
}
