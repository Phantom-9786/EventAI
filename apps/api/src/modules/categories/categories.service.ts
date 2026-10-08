import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateCategoryInput } from '@eventai/validation';
import { PrismaService } from '../../prisma/prisma.service';

// ═══════════════════════════════════════════════════
// Categories: public browsing + admin management.
// Deletion is a soft deactivation so historical
// events keep their category linkage.
// ═══════════════════════════════════════════════════

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async listActive() {
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
      return await this.prisma.category.update({
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
    return { message: 'Category deactivated' };
  }
}
