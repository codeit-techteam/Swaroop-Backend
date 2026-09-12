import { Injectable } from '@nestjs/common';
import { MasterStatus, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  CategoryQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './categories.dto.js';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCategoryDto) {
    const status = dto.status ?? MasterStatus.ACTIVE;
    try {
      return await this.prisma.gradeCategory.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          displayName: (dto.displayName ?? dto.name).trim(),
          description: dto.description,
          parentGroup: dto.parentGroup,
          status,
          isActive: status === MasterStatus.ACTIVE,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Category code already exists');
    }
  }

  async findAll(query: CategoryQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.GradeCategoryWhereInput = { deletedAt: null };

    if (query.status) where.status = query.status;
    if (query.parentGroup) where.parentGroup = query.parentGroup;
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
      this.prisma.gradeCategory.count({ where }),
      this.prisma.gradeCategory.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take,
      }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findActive() {
    return this.prisma.gradeCategory.findMany({
      where: {
        deletedAt: null,
        status: MasterStatus.ACTIVE,
        isActive: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    return assertFound(
      await this.prisma.gradeCategory.findFirst({
        where: { id, deletedAt: null },
      }),
      'Category not found',
    );
  }

  async update(id: string, dto: UpdateCategoryDto) {
    await this.findOne(id);
    const data: Prisma.GradeCategoryUpdateInput = {
      code: dto.code?.trim().toUpperCase(),
      name: dto.name?.trim(),
      displayName: dto.displayName?.trim(),
      description: dto.description,
      parentGroup: dto.parentGroup,
      sortOrder: dto.sortOrder,
    };
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.isActive = dto.status === MasterStatus.ACTIVE;
    }
    try {
      return await this.prisma.gradeCategory.update({ where: { id }, data });
    } catch (error) {
      handlePrismaUnique(error, 'Category code already exists');
    }
  }

  async softDelete(id: string) {
    await this.findOne(id);
    await this.prisma.gradeCategory.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: MasterStatus.INACTIVE,
        isActive: false,
      },
    });
    return { id, deleted: true };
  }
}
