import { Injectable } from '@nestjs/common';
import { MasterStatus, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  CreateUnitDto,
  UnitQueryDto,
  UpdateUnitDto,
} from './units.dto.js';

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUnitDto) {
    try {
      return await this.prisma.unit.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          symbol: dto.symbol?.trim(),
          description: dto.description,
          status: dto.status ?? MasterStatus.ACTIVE,
          decimalPrecision: dto.decimalPrecision ?? 2,
        },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Unit code already exists');
    }
  }

  async findAll(query: UnitQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.UnitWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { symbol: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.unit.count({ where }),
      this.prisma.unit.findMany({
        where,
        orderBy: { code: query.sortOrder === 'desc' ? 'desc' : 'asc' },
        skip,
        take,
      }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findActive() {
    return this.prisma.unit.findMany({
      where: { deletedAt: null, status: MasterStatus.ACTIVE },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string) {
    return assertFound(
      await this.prisma.unit.findFirst({ where: { id, deletedAt: null } }),
      'Unit not found',
    );
  }

  async update(id: string, dto: UpdateUnitDto) {
    await this.findOne(id);
    try {
      return await this.prisma.unit.update({
        where: { id },
        data: {
          code: dto.code?.trim().toUpperCase(),
          name: dto.name?.trim(),
          symbol: dto.symbol?.trim(),
          description: dto.description,
          status: dto.status,
          decimalPrecision: dto.decimalPrecision,
        },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Unit code already exists');
    }
  }

  async softDelete(id: string) {
    await this.findOne(id);
    await this.prisma.unit.update({
      where: { id },
      data: { deletedAt: new Date(), status: MasterStatus.INACTIVE },
    });
    return { id, deleted: true };
  }
}
