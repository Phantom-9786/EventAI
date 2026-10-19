// Explicitly requested phase-three fixtures. Default is a read-only preview.
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('@eventai/database');

async function main() {
  if (!['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Source must be the local database');
  const target = new URL(process.env.PRODUCTION_DATABASE_URL);
  if (!target.hostname.endsWith('.neon.tech')) throw new Error('Expected the configured Neon target');
  target.searchParams.set('connect_timeout', '30');
  target.searchParams.set('connection_limit', '1');
  const local = new PrismaClient();
  const live = new PrismaClient({ datasources: { db: { url: target.toString() } } });
  try {
    const owner = await live.user.findUnique({ where: { email: 'tarunkumarsahu2551@gmail.com' }, include: { organizer: true } });
    if (!owner?.isActive || !owner.isEmailVerified || owner.role !== 'ADMIN' || !owner.organizer?.isVerified) throw new Error('The existing verified administrator/organizer is required');
    const remote = await (await fetch('https://eventai-api-staging.onrender.com/api/events?limit=1')).json();
    if (!remote.events?.[0]?.id || !await live.event.findUnique({ where: { id: remote.events[0].id } })) throw new Error('Target does not match deployed API');
    const sources = await local.event.findMany({
      where: { status: 'PUBLISHED', NOT: [{ slug: { startsWith: 'local-sample-' } }, { slug: { startsWith: 'phase3-' } }] },
      include: { venue: true, category: true, ticketTypes: { where: { isActive: true } }, faqs: true },
    });
    const plan = [];
    for (const category of ['music', 'technology', 'arts-and-theatre', 'food-and-drink', 'health-and-wellness']) {
      const group = sources.filter(event => event.category.slug === category);
      if (!group.length) throw new Error('Missing local reference category: ' + category);
      for (let i = 0; i < 2; i++) plan.push({ source: group[i] ?? group[0], category, variant: !group[i], slot: i + 1 });
    }
    console.log(JSON.stringify({ apply: process.argv.includes('--apply'), previews: plan.map(row => ({ category: row.category, source: row.source.title, variant: row.variant })) }));
    if (!process.argv.includes('--apply')) return;

    // Private local backup. No credentials, session data, or backup files enter Git.
    const backup = { createdAt: new Date().toISOString(), tables: {} };
    const tables = await live.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`;
    for (const { tablename } of tables) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(tablename)) throw new Error('Unexpected table name');
      const rows = await live.$queryRawUnsafe('SELECT COALESCE(json_agg(row_to_json(t)), \'[]\'::json) AS rows FROM public."' + tablename + '" t');
      backup.tables[tablename] = rows[0].rows;
    }
    const backupPath = path.join(process.env.TEMP ?? '.', 'eventpoint-before-phase3-previews-' + Date.now() + '.json');
    fs.writeFileSync(backupPath, JSON.stringify(backup));
    console.log('Backup saved: ' + backupPath);

    const results = await live.$transaction(async tx => {
      const published = [];
      for (const row of plan) {
        const source = row.source;
        const slug = 'phase3-preview-' + source.slug + (row.variant ? '-second-edition' : '');
        const prior = await tx.event.findUnique({ where: { slug } });
        if (prior) {
          if (prior.organizerId !== owner.organizer.id) throw new Error('Fixture slug belongs to another organizer');
          published.push({ id: prior.id, slug, created: false });
          continue;
        }
        const category = await tx.category.findUnique({ where: { slug: row.category } });
        if (!category?.isActive) throw new Error('Missing active target category');
        let venue = await tx.venue.findFirst({ where: { organizerId: owner.organizer.id, name: source.venue.name, city: source.venue.city } });
        if (!venue) {
          const { name, description, address, city, state, zipCode, country, latitude, longitude, capacity, amenities } = source.venue;
          venue = await tx.venue.create({ data: { name, description, address, city, state, zipCode, country, latitude, longitude, capacity, amenities, images: source.venue.images.filter(url => url.startsWith('https://')), organizerId: owner.organizer.id } });
        }
        const start = new Date(source.startDate);
        if (row.variant) start.setUTCDate(start.getUTCDate() + 14);
        if (start <= new Date()) throw new Error('Preview start date must be in the future');
        const duration = Math.max(3600000, +source.endDate - +source.startDate);
        const images = [...new Set([source.coverImage, ...source.images].filter(url => typeof url === 'string' && url.startsWith('https://')))];
        const title = source.title + (row.variant ? ' · Second Edition' : '') + ' · Phase 3 Preview';
        const event = await tx.event.create({ data: {
          title, slug, organizerId: owner.organizer.id, categoryId: category.id, venueId: venue.id,
          description: 'PHASE 3 TESTING PREVIEW — this is a sample listing for testing EventPoint, not an announcement of a real scheduled event.\n\n' + source.description,
          shortDescription: 'Phase 3 testing preview. ' + (source.shortDescription ?? '').slice(0, 220),
          tags: [...new Set([...source.tags, 'phase3-preview'])].slice(0, 10),
          coverImage: images[0] ?? null, images, startDate: start, endDate: new Date(+start + duration), status: 'PUBLISHED',
          policies: 'Testing preview only. ' + (source.policies ?? ''), cancellationPolicy: source.cancellationPolicy,
          ticketTypes: { create: source.ticketTypes.map(tier => ({ name: tier.name, description: tier.description, price: tier.price, currency: tier.currency, totalQuantity: Math.max(20, tier.totalQuantity), availableQuantity: Math.max(20, tier.totalQuantity), maxPerBooking: Math.max(6, tier.maxPerBooking), isActive: true })) },
          faqs: { create: source.faqs.map(faq => ({ question: faq.question, answer: faq.answer, order: faq.order })) },
        } });
        await tx.auditLog.create({ data: { userId: owner.id, action: 'EVENT_APPROVED', entity: 'Event', entityId: event.id, details: { reason: 'Owner-requested phase-three preview fixture', sourceSlug: source.slug, phase: 3 } } });
        published.push({ id: event.id, slug, created: true });
      }
      return published;
    }, { timeout: 120000 });
    fs.mkdirSync('.local/eventpoint-sites', { recursive: true });
    fs.writeFileSync('.local/eventpoint-sites/production-phase3-preview-manifest.json', JSON.stringify({ userId: owner.id, organizerId: owner.organizer.id, events: results }, null, 2));
    console.log(JSON.stringify({ previews: results.length, created: results.filter(row => row.created).length, categories: 5, cloudinaryUploads: 0, events: results }));
  } finally { await local.$disconnect(); await live.$disconnect(); }
}
main().catch(error => { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database]')); process.exitCode = 1; });
