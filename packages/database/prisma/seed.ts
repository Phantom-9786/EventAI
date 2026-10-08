// ═══════════════════════════════════════════════════
// Seed: base categories for event discovery.
// Run with: npm run db:seed (turbo → packages/database)
// ═══════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  { name: 'Music', slug: 'music', description: 'Concerts, festivals, and live music', icon: 'music', color: '#8B5CF6' },
  { name: 'Sports', slug: 'sports', description: 'Matches, tournaments, and fitness events', icon: 'trophy', color: '#10B981' },
  { name: 'Technology', slug: 'technology', description: 'Conferences, hackathons, and meetups', icon: 'cpu', color: '#3B82F6' },
  { name: 'Food & Drink', slug: 'food-and-drink', description: 'Tastings, food festivals, and dinners', icon: 'utensils', color: '#F59E0B' },
  { name: 'Arts & Theatre', slug: 'arts-and-theatre', description: 'Plays, exhibitions, and performances', icon: 'palette', color: '#EC4899' },
  { name: 'Business', slug: 'business', description: 'Summits, networking, and workshops', icon: 'briefcase', color: '#6366F1' },
  { name: 'Comedy', slug: 'comedy', description: 'Stand-up, improv, and open mics', icon: 'smile', color: '#EF4444' },
  { name: 'Health & Wellness', slug: 'health-and-wellness', description: 'Yoga, retreats, and wellness sessions', icon: 'heart', color: '#14B8A6' },
];

async function main() {
  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, description: category.description, icon: category.icon, color: category.color },
      create: category,
    });
  }
  console.log(`Seeded ${categories.length} categories`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
