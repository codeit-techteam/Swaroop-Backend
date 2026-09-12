import { Injectable } from '@nestjs/common';
import { MasterStatus, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  CreateSubcategoryDto,
  SubcategoryQueryDto,
  UpdateSubcategoryDto,
} from './subcategories.dto.js';

@Injectable()
export class SubcategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCategory(categoryId: string) {
    await assertFound(
      await this.prisma.gradeCategory.findFirst({
        where: { id: categoryId, deletedAt: null },
      }),
      'Category not found',
    );
  }

  async create(dto: CreateSubcategoryDto) {
    await this.assertCategory(dto.categoryId);
    try {
      return await this.prisma.subcategory.create({
        data: {
          categoryId: dto.categoryId,
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          displayName: (dto.displayName ?? dto.name).trim(),
          description: dto.description,
          status: dto.status ?? MasterStatus.ACTIVE,
          sortOrder: dto.sortOrder ?? 0,
        },
        include: { category: true },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Subcategory code already exists for category');
    }
  }

  async findAll(query: SubcategoryQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.SubcategoryWhereInput = { deletedAt: null };

    if (query.status) where.status = query.status;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ];
    }

    const sortBy = [
      'code',
      'name',
      'sortOrder',
      'createdAt',
      'updatedAt',
    ].includes(query.sortBy ?? '')
      ? (query.sortBy as string)
      : 'sortOrder';
    const sortOrder = query.sortOrder === 'desc' ? 'desc' : 'asc';

    const [total, items] = await this.prisma.$transaction([
      this.prisma.subcategory.count({ where }),
      this.prisma.subcategory.findMany({
        where,
        include: { category: true },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take,
      }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findByCategory(categoryId: string) {
    await this.assertCategory(categoryId);
    return this.prisma.subcategory.findMany({
      where: { categoryId, deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    return assertFound(
      await this.prisma.subcategory.findFirst({
        where: { id, deletedAt: null },
        include: { category: true },
      }),
      'Subcategory not found',
    );
  }

  async update(id: string, dto: UpdateSubcategoryDto) {
    await this.findOne(id);
    if (dto.categoryId) {
      await this.assertCategory(dto.categoryId);
    }
    try {
      return await this.prisma.subcategory.update({
        where: { id },
        data: {
          categoryId: dto.categoryId,
          code: dto.code?.trim().toUpperCase(),
          name: dto.name?.trim(),
          displayName: dto.displayName?.trim(),
          description: dto.description,
          status: dto.status,
          sortOrder: dto.sortOrder,
        },
        include: { category: true },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Subcategory code already exists for category');
    }
  }

  async softDelete(id: string) {
    await this.findOne(id);
    await this.prisma.subcategory.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: MasterStatus.INACTIVE,
      },
    });
    return { id, deleted: true };
  }
}
