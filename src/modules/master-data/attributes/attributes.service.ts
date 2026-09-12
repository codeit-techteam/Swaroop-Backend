import { Injectable } from '@nestjs/common';
import { MasterStatus, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  AttributeQueryDto,
  CreateAttributeDto,
  UpdateAttributeDto,
} from './attributes.dto.js';

@Injectable()
export class AttributesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAttributeDto) {
    if (dto.unitId) {
      await assertFound(
        await this.prisma.unit.findFirst({
          where: { id: dto.unitId, deletedAt: null },
        }),
        'Unit not found',
      );
    }
    try {
      return await this.prisma.productAttribute.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          displayName: (dto.displayName ?? dto.name).trim(),
          description: dto.description,
          dataType: dto.dataType,
          unitId: dto.unitId,
          isRequired: dto.isRequired ?? false,
          status: dto.status ?? MasterStatus.ACTIVE,
          sortOrder: dto.sortOrder ?? 0,
        },
        include: { unit: true },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Attribute code already exists');
    }
  }

  async findAll(query: AttributeQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.ProductAttributeWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.dataType) where.dataType = query.dataType;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.productAttribute.count({ where }),
      this.prisma.productAttribute.findMany({
        where,
        include: { unit: true },
        orderBy: { sortOrder: query.sortOrder === 'desc' ? 'desc' : 'asc' },
        skip,
        take,
      }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    return assertFound(
      await this.prisma.productAttribute.findFirst({
        where: { id, deletedAt: null },
        include: { unit: true },
      }),
      'Attribute not found',
    );
  }

  async update(id: string, dto: UpdateAttributeDto) {
    await this.findOne(id);
    if (dto.unitId) {
      await assertFound(
        await this.prisma.unit.findFirst({
          where: { id: dto.unitId, deletedAt: null },
        }),
        'Unit not found',
      );
    }
    try {
      return await this.prisma.productAttribute.update({
        where: { id },
        data: {
          code: dto.code?.trim().toUpperCase(),
          name: dto.name?.trim(),
          displayName: dto.displayName?.trim(),
          description: dto.description,
          dataType: dto.dataType,
          unitId: dto.unitId,
          isRequired: dto.isRequired,
          status: dto.status,
          sortOrder: dto.sortOrder,
        },
        include: { unit: true },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Attribute code already exists');
    }
  }

  async softDelete(id: string) {
    await this.findOne(id);
    await this.prisma.productAttribute.update({
      where: { id },
      data: { deletedAt: new Date(), status: MasterStatus.INACTIVE },
    });
    return { id, deleted: true };
  }
}
