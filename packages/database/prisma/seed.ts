// ═══════════════════════════════════════════════════
// Seed: categories + demo accounts and demo events.
// Run with: npm run db:seed (turbo → packages/database)
// ═══════════════════════════════════════════════════

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

if (process.env.NODE_ENV !== 'development') {
  throw new Error('Database seed is restricted to NODE_ENV=development');
}

const prisma = new PrismaClient();

const categories = [
  { name: 'Music', slug: 'music', description: 'Concerts, festivals, and live music', icon: 'music', color: '#8B5CF6' },
  { name: 'Sports', slug: 'sports', description: 'Matches, tournaments, and fitness events', icon: 'trophy', color: '#10B981' },
  { name: 'Technology', slug: 'technology', description: 'Conferences, hackathons, and meetups', icon: 'cpu', color: '#3B82F6' },
  { name: 'Food & Drink', slug: 'food-and-drink', description: 'Tastings, food festivals, and dinners', icon: 'utensils', color: '#F59E0B' },
  { name: 'Arts & Theatre', slug: 'arts-and-theatre', description: 'Plays, exhibitions, and performances', icon: 'palette', color: '#EC8099' },
  { name: 'Business', slug: 'business', description: 'Summits, networking, and workshops', icon: 'briefcase', color: '#6366F1' },
  { name: 'Comedy', slug: 'comedy', description: 'Stand-up, improv, and open mics', icon: 'smile', color: '#EF4444' },
  { name: 'Health & Wellness', slug: 'health-and-wellness', description: 'Yoga, retreats, and wellness sessions', icon: 'heart', color: '#14B8A6' },
];

const DEMO_PASSWORD = 'DemoPass123';

interface DemoEvent {
  title: string;
  categorySlug: string;
  daysFromNow: number;
  price: number; // paise
  description: string;
}

const demoEvents: DemoEvent[] = [
  {
    title: 'Mumbai Indie Night',
    categorySlug: 'music',
    daysFromNow: 14,
    price: 49900,
    description: 'An evening of independent music by the sea with three live bands and food stalls.',
  },
  {
    title: 'DevCon Mumbai 2026',
    categorySlug: 'technology',
    daysFromNow: 30,
    price: 149900,
    description: 'A one-day developer conference with hands-on workshops, talks, and networking.',
  },
  {
    title: 'Sunset Acoustic Sessions',
    categorySlug: 'music',
    daysFromNow: 45,
    price: 79900,
    description: 'Acoustic sets at golden hour on the promenade featuring local singer-songwriters.',
  },
];

async function seedDemoUsers() {
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  const organizerUser = await prisma.user.upsert({
    where: { email: 'demo.organizer@eventai.test' },
    update: {},
    create: {
      email: 'demo.organizer@eventai.test',
      passwordHash,
      firstName: 'Demo',
      lastName: 'Organizer',
      username: 'demoorganizer',
      role: 'ORGANIZER',
      isActive: true,
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'customer@eventai.test' },
    update: {},
    create: {
      email: 'customer@eventai.test',
      passwordHash,
      firstName: 'Cara',
      lastName: 'Customer',
      username: 'democustomer',
      role: 'CUSTOMER',
      isActive: true,
    },
  });

  return { organizerUser, customer };
}

async function seedDemoOrganizerContent(organizerUserId: string) {
  const organizer = await prisma.organizer.upsert({
    where: { userId: organizerUserId },
    update: {},
    create: {
      userId: organizerUserId,
      organizationName: 'Demo Events Co',
      description: 'Demo organizer shipped with the seed',
    },
  });

  let venue = await prisma.venue.findFirst({
    where: { organizerId: organizer.id, name: 'Demo Arena' },
  });
  if (!venue) {
    venue = await prisma.venue.create({
      data: {
        organizerId: organizer.id,
        name: 'Demo Arena',
        address: 'Marine Drive, Nariman Point',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        capacity: 5000,
        description: 'Seaside demo arena shipped with the seed',
        latitude: 18.944,
        longitude: 72.8235,
      },
    });
  } else if (venue.latitude == null || venue.longitude == null) {
    venue = await prisma.venue.update({
      where: { id: venue.id },
      data: { latitude: 18.944, longitude: 72.8235 },
    });
  }

  const categoriesBySlug = new Map(
    (await prisma.category.findMany({ where: { slug: { in: demoEvents.map((e) => e.categorySlug) } } })).map(
      (c) => [c.slug, c],
    ),
  );

  for (const demo of demoEvents) {
    const category = categoriesBySlug.get(demo.categorySlug);
    if (!category) continue;

    const existing = await prisma.event.findFirst({
      where: { title: demo.title, organizerId: organizer.id },
      select: { id: true },
    });
    if (existing) continue;

    const startDate = new Date(Date.now() + demo.daysFromNow * 86400000);
    startDate.setUTCHours(19, 0, 0, 0);
    const endDate = new Date(startDate.getTime() + 3 * 3600000);

    const event = await prisma.event.create({
      data: {
        title: demo.title,
        slug: `${demo.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`,
        description: demo.description,
        shortDescription: demo.description,
        categoryId: category.id,
        organizerId: organizer.id,
        venueId: venue.id,
        startDate,
        endDate,
        tags: ['demo'],
        status: 'PUBLISHED',
      },
    });

    await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'General Admission',
        price: demo.price,
        totalQuantity: 200,
        availableQuantity: 200,
        maxPerBooking: 5,
      },
    });
    await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'VIP',
        price: demo.price * 3,
        totalQuantity: 50,
        availableQuantity: 50,
        maxPerBooking: 4,
      },
    });
  }
}

async function main() {
  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: { name: category.name, description: category.description, icon: category.icon, color: category.color },
      create: category,
    });
  }
  console.log(`Seeded ${categories.length} categories`);

  const { organizerUser } = await seedDemoUsers();
  await seedDemoOrganizerContent(organizerUser.id);
  console.log('Seeded demo organizer/customer accounts and demo events');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
