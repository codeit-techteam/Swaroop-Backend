import { Injectable } from '@nestjs/common';
import { MasterStatus, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  ApplicationQueryDto,
  CreateApplicationDto,
  UpdateApplicationDto,
} from './applications.dto.js';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateApplicationDto) {
    try {
      return await this.prisma.application.create({
        data: {
          code: dto.code.trim().toUpperCase().replace(/\s+/g, '_'),
          name: dto.name.trim(),
          displayName: (dto.displayName ?? dto.name).trim(),
          description: dto.description,
          status: dto.status ?? MasterStatus.ACTIVE,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Application code already exists');
    }
  }

  async findAll(query: ApplicationQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.ApplicationWhereInput = { deletedAt: null };

    if (query.status) where.status = query.status;
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
      this.prisma.application.count({ where }),
      this.prisma.application.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take,
      }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findActive() {
    return this.prisma.application.findMany({
      where: { deletedAt: null, status: MasterStatus.ACTIVE },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(id: string) {
    return assertFound(
      await this.prisma.application.findFirst({
        where: { id, deletedAt: null },
      }),
      'Application not found',
    );
  }

  async update(id: string, dto: UpdateApplicationDto) {
    await this.findOne(id);
    try {
      return await this.prisma.application.update({
        where: { id },
        data: {
          code: dto.code?.trim().toUpperCase().replace(/\s+/g, '_'),
          name: dto.name?.trim(),
          displayName: dto.displayName?.trim(),
          description: dto.description,
          status: dto.status,
          sortOrder: dto.sortOrder,
        },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Application code already exists');
    }
  }

  async softDelete(id: string) {
    await this.findOne(id);
    await this.prisma.application.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: MasterStatus.INACTIVE,
      },
    });
    return { id, deleted: true };
  }
}
