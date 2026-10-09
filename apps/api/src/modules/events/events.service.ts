import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import type { CreateEventInput, EventSearchInput, UpdateEventInput } from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';

const EVENT_SUMMARY_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  venue: { select: { id: true, name: true, city: true } },
  organizer: { select: { id: true, organizationName: true } },
  ticketTypes: { select: { price: true } },
} satisfies Prisma.EventInclude;

const EVENT_DETAIL_INCLUDE = {
  category: { select: { id: true, name: true, slug: true, icon: true, color: true } },
  venue: true,
  organizer: { select: { id: true, organizationName: true, logo: true, isVerified: true } },
  ticketTypes: {
    where: { isActive: true },
    orderBy: { price: 'asc' as const },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      totalQuantity: true,
      availableQuantity: true,
      maxPerBooking: true,
      saleStartDate: true,
      saleEndDate: true,
      section: { select: { id: true, name: true } },
    },
  },
  faqs: { orderBy: { order: 'asc' } },
} satisfies Prisma.EventInclude;

const EVENT_DETAIL_MANAGE_INCLUDE = {
  category: { select: { id: true, name: true, slug: true, icon: true, color: true } },
  venue: true,
  organizer: { select: { id: true, organizationName: true, logo: true, isVerified: true } },
  ticketTypes: {
    orderBy: { price: 'asc' as const },
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      totalQuantity: true,
      availableQuantity: true,
      maxPerBooking: true,
      saleStartDate: true,
      saleEndDate: true,
      isActive: true,
      section: { select: { id: true, name: true } },
    },
  },
  faqs: { orderBy: { order: 'asc' } },
} satisfies Prisma.EventInclude;

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function priceRange(prices: number[]): { minPrice: number | null; maxPrice: number | null } {
  if (prices.length === 0) return { minPrice: null, maxPrice: null };
  return { minPrice: Math.min(...prices), maxPrice: Math.max(...prices) };
}

// ═══════════════════════════════════════════════════
// Events: organizer CRUD, publish/cancel workflow, and
// public browse/search over published events.
//
// Search combines PostgreSQL full-text search
// (search_vector, weighted by trigger) with structured
// filters (category, city, dates, price) and sorting
// (relevance/date/price/popularity), via parameterised
// raw SQL for the id/rank pass and Prisma hydration.
// ═══════════════════════════════════════════════════

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createEvent(organizerId: string, input: CreateEventInput) {
    const startDate = new Date(input.startDate);
    if (startDate.getTime() <= Date.now()) {
      throw new ConflictException('Start date must be in the future');
    }

    await this.assertCategoryAndVenue(organizerId, input.categoryId, input.venueId);

    const slug = `${slugify(input.title)}-${randomBytes(4).toString('hex')}`;
    return this.prisma.event.create({
      data: {
        title: input.title,
        slug,
        description: input.description,
        shortDescription: input.shortDescription,
        categoryId: input.categoryId,
        organizerId,
        venueId: input.venueId,
        startDate,
        endDate: new Date(input.endDate),
        tags: input.tags ?? [],
        policies: input.policies,
        cancellationPolicy: input.cancellationPolicy,
        status: 'DRAFT',
      },
      include: EVENT_DETAIL_MANAGE_INCLUDE,
    });
  }

  async getEventForManage(organizerId: string, idOrSlug: string) {
    const event = await this.findOwned(organizerId, idOrSlug);
    return this.prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      include: EVENT_DETAIL_MANAGE_INCLUDE,
    });
  }

  async getPublishedEvent(idOrSlug: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const event = await this.prisma.event.findFirst({
      where: { ...(isUuid ? { id: idOrSlug } : { slug: idOrSlug }), status: 'PUBLISHED' },
      include: EVENT_DETAIL_INCLUDE,
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  /**
   * Content-based recommendations: upcoming published events ranked by
   * category match first, then same-city, then nearest in time. Postgres
   * filtering plus in-memory scoring — no external vector store needed.
   */
  async findSimilarEvents(idOrSlug: string, limit = 4) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const event = await this.prisma.event.findFirst({
      where: { ...(isUuid ? { id: idOrSlug } : { slug: idOrSlug }), status: 'PUBLISHED' },
      select: { id: true, categoryId: true, venue: { select: { city: true } } },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const include = {
      category: { select: { id: true, name: true, slug: true } },
      venue: { select: { id: true, name: true, city: true } },
      organizer: { select: { id: true, organizationName: true } },
    } satisfies Prisma.EventInclude;

    // Same-category candidates are the strongest signal; same-city others
    // fill the remainder. Both pools are upcoming published events.
    const [sameCategory, sameCity] = await this.prisma.$transaction([
      this.prisma.event.findMany({
        where: {
          id: { not: event.id },
          status: 'PUBLISHED',
          startDate: { gte: new Date() },
          categoryId: event.categoryId,
        },
        include,
        orderBy: { startDate: 'asc' },
        take: limit,
      }),
      this.prisma.event.findMany({
        where: {
          id: { not: event.id },
          status: 'PUBLISHED',
          startDate: { gte: new Date() },
          categoryId: { not: event.categoryId },
          venue: { city: { equals: event.venue.city, mode: 'insensitive' } },
        },
        include,
        orderBy: { startDate: 'asc' },
        take: limit,
      }),
    ]);

    return [...sameCategory, ...sameCity].slice(0, limit);
  }

  async updateEvent(organizerId: string, idOrSlug: string, input: UpdateEventInput) {
    const owned = await this.findOwned(organizerId, idOrSlug);

    if (owned.status === 'CANCELLED' || owned.status === 'COMPLETED') {
      throw new ConflictException(
        `Cannot update a ${owned.status.toLowerCase()} event`,
      );
    }

    if (input.categoryId !== undefined || input.venueId !== undefined) {
      await this.assertCategoryAndVenue(
        organizerId,
        input.categoryId ?? owned.categoryId,
        input.venueId ?? owned.venueId,
      );
    }

    const startDate = input.startDate !== undefined ? new Date(input.startDate) : undefined;
    const endDate = input.endDate !== undefined ? new Date(input.endDate) : undefined;
    const effectiveStart = startDate ?? owned.startDate;
    const effectiveEnd = endDate ?? owned.endDate;
    if (effectiveEnd <= effectiveStart) {
      throw new ConflictException('End date must be after start date');
    }

    return this.prisma.event.update({
      where: { id: owned.id },
      data: {
        ...(input.title !== undefined && { title: input.title }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.shortDescription !== undefined && { shortDescription: input.shortDescription }),
        ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
        ...(input.venueId !== undefined && { venueId: input.venueId }),
        ...(startDate !== undefined && { startDate }),
        ...(endDate !== undefined && { endDate }),
        ...(input.tags !== undefined && { tags: input.tags }),
        ...(input.policies !== undefined && { policies: input.policies }),
        ...(input.cancellationPolicy !== undefined && { cancellationPolicy: input.cancellationPolicy }),
      },
      include: EVENT_DETAIL_MANAGE_INCLUDE,
    });
  }

  async publishEvent(organizerId: string, idOrSlug: string) {
    const owned = await this.findOwned(organizerId, idOrSlug);

    if (owned.status !== 'DRAFT') {
      throw new ConflictException(`Only draft events can be published (current: ${owned.status})`);
    }
    if (owned.startDate.getTime() <= Date.now()) {
      throw new ConflictException('Cannot publish an event whose start date has passed');
    }

    return this.prisma.event.update({
      where: { id: owned.id },
      data: { status: 'PUBLISHED' },
      include: EVENT_DETAIL_MANAGE_INCLUDE,
    });
  }

  async cancelEvent(organizerId: string, idOrSlug: string) {
    const owned = await this.findOwned(organizerId, idOrSlug);

    if (owned.status !== 'DRAFT' && owned.status !== 'PUBLISHED') {
      throw new ConflictException(`Cannot cancel a ${owned.status.toLowerCase()} event`);
    }

    return this.prisma.event.update({
      where: { id: owned.id },
      data: { status: 'CANCELLED' },
      include: EVENT_DETAIL_MANAGE_INCLUDE,
    });
  }

  async deleteEvent(organizerId: string, idOrSlug: string) {
    const owned = await this.findOwned(organizerId, idOrSlug);

    if (owned.status !== 'DRAFT') {
      throw new ConflictException(
        'Only draft events can be deleted — cancel published events instead',
      );
    }

    await this.prisma.event.delete({ where: { id: owned.id } });
    return { message: 'Event deleted' };
  }

  /**
   * Public search over PUBLISHED events. When `query` is present the
   * FTS vector decides relevance ordering; otherwise structured sorts
   * apply. Ids are selected via parameterised raw SQL, then hydrated
   * through Prisma with relations and price ranges.
   */
  async searchEvents(input: EventSearchInput) {
    const offset = (input.page - 1) * input.limit;

    const conditions: Prisma.Sql[] = [Prisma.sql`e.status = 'PUBLISHED'`];
    if (input.query) {
      conditions.push(
        Prisma.sql`e.search_vector @@ websearch_to_tsquery('english', ${input.query})`,
      );
    }
    if (input.categoryId) {
      conditions.push(Prisma.sql`e.category_id = ${input.categoryId}`);
    }
    if (input.category) {
      conditions.push(
        Prisma.sql`e.category_id IN (SELECT c.id FROM categories c WHERE c.slug = ${input.category} AND c.is_active = true)`,
      );
    }
    if (input.city) {
      conditions.push(Prisma.sql`v.city ILIKE ${`%${input.city}%`}`);
    }
    if (input.dateFrom) {
      conditions.push(Prisma.sql`e.start_date >= ${new Date(input.dateFrom)}`);
    }
    if (input.dateTo) {
      conditions.push(Prisma.sql`e.end_date <= ${new Date(input.dateTo)}`);
    }
    if (input.isFeatured !== undefined) {
      conditions.push(Prisma.sql`e.is_featured = ${input.isFeatured}`);
    }
    if (input.priceMin !== undefined || input.priceMax !== undefined) {
      const minPrice = Prisma.sql`(SELECT MIN(tt.price) FROM ticket_types tt WHERE tt.event_id = e.id)`;
      if (input.priceMin !== undefined) {
        conditions.push(Prisma.sql`${minPrice} >= ${input.priceMin}`);
      }
      if (input.priceMax !== undefined) {
        conditions.push(Prisma.sql`${minPrice} <= ${input.priceMax}`);
      }
    }
    const where = Prisma.join(conditions, ' AND ');

    const dir = input.sortDir === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    let orderBy: Prisma.Sql;
    if (input.query) {
      // Relevance first when searching
      orderBy = Prisma.sql`ts_rank(e.search_vector, websearch_to_tsquery('english', ${input.query})) DESC, e.start_date ASC`;
    } else {
      switch (input.sortBy) {
        case 'price':
          orderBy = Prisma.sql`(SELECT MIN(tt.price) FROM ticket_types tt WHERE tt.event_id = e.id) ${dir} NULLS LAST`;
          break;
        case 'popularity':
          orderBy = Prisma.sql`(SELECT COUNT(*) FROM bookings b WHERE b.event_id = e.id) ${dir}`;
          break;
        case 'createdAt':
          orderBy = Prisma.sql`e.created_at ${dir}`;
          break;
        case 'date':
        default:
          orderBy = Prisma.sql`e.start_date ${dir}`;
          break;
      }
    }

    const table = Prisma.sql`events e JOIN venues v ON v.id = e.venue_id`;
    const [rows, countRows] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT e.id FROM ${table} WHERE ${where} ORDER BY ${orderBy} LIMIT ${input.limit} OFFSET ${offset}`,
      ),
      this.prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`SELECT COUNT(*)::int AS total FROM ${table} WHERE ${where}`,
      ),
    ]);

    const total = countRows[0]?.total ?? 0;
    if (rows.length === 0) {
      return { events: [], total, page: input.page, limit: input.limit, pages: Math.ceil(total / input.limit) };
    }

    const hydrated = await this.prisma.event.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: EVENT_SUMMARY_INCLUDE,
    });
    const byId = new Map(hydrated.map((e) => [e.id, e]));
    const events = rows
      .map((r) => byId.get(r.id))
      .filter((e): e is (typeof hydrated)[number] => e !== undefined)
      .map((e) => ({
        ...e,
        ...priceRange(e.ticketTypes.map((t) => t.price)),
        ticketTypes: undefined,
      }));

    return { events, total, page: input.page, limit: input.limit, pages: Math.ceil(total / input.limit) };
  }

  /** Resolves an event owned by the organizer by id or slug (throws 404). */
  async requireOwnedEvent(organizerId: string, idOrSlug: string) {
    return this.findOwned(organizerId, idOrSlug);
  }

  private async findOwned(organizerId: string, idOrSlug: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const event = await this.prisma.event.findFirst({
      where: { organizerId, ...(isUuid ? { id: idOrSlug } : { slug: idOrSlug }) },
      select: { id: true, status: true, startDate: true, endDate: true, categoryId: true, venueId: true },
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private async assertCategoryAndVenue(
    organizerId: string,
    categoryId: string,
    venueId: string,
  ): Promise<void> {
    const [category, venue] = await this.prisma.$transaction([
      this.prisma.category.findFirst({ where: { id: categoryId, isActive: true }, select: { id: true } }),
      this.prisma.venue.findFirst({ where: { id: venueId, organizerId }, select: { id: true } }),
    ]);
    if (!category) {
      throw new NotFoundException('Category not found or inactive');
    }
    if (!venue) {
      throw new ForbiddenException('Venue not found among your venues');
    }
  }
}
