import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '../../common/exceptions';
import type { CreateCategoryInput } from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../common/cache/cache.service';

// ═══════════════════════════════════════════════════
// Categories: public browsing + admin management.
// Deletion is a soft deactivation so historical
// events keep their category linkage.
// ═══════════════════════════════════════════════════

@Injectable()
export class CategoriesService {
  private static readonly LIST_CACHE_KEY = 'categories:active';

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private async invalidateList() {
    await this.cache.invalidatePrefix('categories:');
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
    await this.cache.set(CategoriesService.LIST_CACHE_KEY, categories, 300);
    return categories;
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
