import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '../../common/exceptions';
import type { CreateCategoryInput } from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';
import { createHash } from 'crypto';

export interface CategorySpotlight {
  id: string;
  name: string;
  slug: string;
  upcomingEvents: number;
  paidTickets: number;
  coverImage: string | null;
  spotlightEyebrow?: string | null;
  spotlightTitle?: string | null;
  spotlightDescription?: string | null;
}

/** Daily, stable tie rotation avoids flicker and gives equal categories a turn. */
export function chooseCategorySpotlights(rows: CategorySpotlight[], day: string): CategorySpotlight[] {
  const tie = (slug: string) => createHash('sha256').update(day + ':' + slug).digest('hex');
  return rows.filter(row => row.upcomingEvents > 0).sort((a, b) =>
    b.paidTickets - a.paidTickets || tie(a.slug).localeCompare(tie(b.slug)),
  ).slice(0, 2);
}

// ═══════════════════════════════════════════════════
// Categories: public browsing + admin management.
// Deletion is a soft deactivation so historical
// events keep their category linkage.
// ═══════════════════════════════════════════════════

@Injectable()
export class CategoriesService {
  private static readonly LIST_CACHE_KEY = 'categories:active:v3';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private async invalidateList() {
    await this.cache.invalidatePrefix('categories:');
    await this.cache.invalidatePrefix('events:browse:');
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async listActive() {
    const cached = await this.cache.get<Awaited<ReturnType<CategoriesService['listActiveUncached']>>>(
      CategoriesService.LIST_CACHE_KEY,
    );
    if (cached) return cached;
    const categories = await this.listActiveUncached();
    await this.cache.set(CategoriesService.LIST_CACHE_KEY, categories, 30 * 60);
    return categories;
  }

  async spotlights() {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const key = 'categories:spotlights:v3:' + day;
    const cached = await this.cache.get<CategorySpotlight[]>(key);
    if (cached) return cached;
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.$queryRaw<CategorySpotlight[]>`
      WITH eligible AS (
        SELECT e.id, e.category_id, e.start_date, e.cover_image, e.images
        FROM events e JOIN categories c ON c.id=e.category_id
        WHERE e.status='PUBLISHED' AND e.start_date >= ${now} AND c.is_active=true
      )
      SELECT c.id, c.name, c.slug, c.spotlight_eyebrow AS "spotlightEyebrow",
        c.spotlight_title AS "spotlightTitle", c.spotlight_description AS "spotlightDescription",
        COUNT(e.id)::int AS "upcomingEvents",
        (SELECT COUNT(t.id)::int FROM tickets t
          JOIN bookings b ON b.id=t.booking_id JOIN payments p ON p.booking_id=b.id
          JOIN eligible sold ON sold.id=t.event_id
          WHERE sold.category_id=c.id AND b.status='CONFIRMED' AND p.status='CAPTURED'
            AND p.amount > 0 AND t.status IN ('VALID','USED') AND t.created_at >= ${cutoff}) AS "paidTickets",
        COALESCE(NULLIF(c.cover_image,''), (SELECT COALESCE(NULLIF(photo.cover_image,''), photo.images[1]) FROM eligible photo
          WHERE photo.category_id=c.id ORDER BY photo.start_date, photo.id LIMIT 1)) AS "coverImage"
      FROM categories c JOIN eligible e ON e.category_id=c.id
      GROUP BY c.id, c.name, c.slug`;
    const selected = chooseCategorySpotlights(rows, day);
    await this.cache.set(key, selected, 60);
    return selected;
  }

  private listActiveUncached() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        icon: true,
        color: true,
        coverImage: true,
        spotlightEyebrow: true,
        spotlightTitle: true,
        spotlightDescription: true,
        _count: { select: { events: { where: { status: 'PUBLISHED' } } } },
      },
    });
  }

  async create(input: CreateCategoryInput) {
    const slug = this.slugify(input.name);
    const existing = await this.prisma.category.findFirst({
      where: { OR: [{ name: input.name }, { slug }] },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('A category with that name already exists');
    }
    return this.prisma.category.create({
      data: {
        name: input.name,
        slug,
        description: input.description,
        icon: input.icon,
        color: input.color,
        coverImage: input.coverImage,
        spotlightEyebrow: input.spotlightEyebrow,
        spotlightTitle: input.spotlightTitle,
        spotlightDescription: input.spotlightDescription,
      },
    }).then(async (created) => {
      await this.invalidateList();
      return created;
    });
  }

  async update(id: string, input: Partial<CreateCategoryInput> & { isActive?: boolean }) {
    if (input.name) {
      const slug = this.slugify(input.name);
      const clash = await this.prisma.category.findFirst({
        where: { slug, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException('A category with that name already exists');
      }
    }
    try {
      const updated = await this.prisma.category.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.name !== undefined && { slug: this.slugify(input.name) }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.icon !== undefined && { icon: input.icon }),
          ...(input.color !== undefined && { color: input.color }),
          ...(input.coverImage !== undefined && { coverImage: input.coverImage }),
          ...(input.spotlightEyebrow !== undefined && { spotlightEyebrow: input.spotlightEyebrow }),
          ...(input.spotlightTitle !== undefined && { spotlightTitle: input.spotlightTitle }),
          ...(input.spotlightDescription !== undefined && { spotlightDescription: input.spotlightDescription }),
          ...(input.isActive !== undefined && { isActive: input.isActive }),
        },
      });
      await this.invalidateList();
      return updated;
    } catch {
      throw new NotFoundException('Category not found');
    }
  }

  async deactivate(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { isActive: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
    await this.prisma.category.update({
      where: { id },
      data: { isActive: false },
    });
    await this.invalidateList();
    return { message: 'Category deactivated' };
  }
}
