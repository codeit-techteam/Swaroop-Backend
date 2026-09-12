import { Injectable } from '@nestjs/common';
import { MasterStatus, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  CreateWarehouseDto,
  UpdateWarehouseDto,
  WarehouseQueryDto,
} from './warehouses.dto.js';

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWarehouseDto) {
    if (dto.locationId) {
      await assertFound(
        await this.prisma.location.findFirst({
          where: { id: dto.locationId, deletedAt: null },
        }),
        'Location not found',
      );
    }
    const status = dto.status ?? MasterStatus.ACTIVE;
    try {
      return await this.prisma.warehouse.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          description: dto.description,
          locationId: dto.locationId,
          organizationId: dto.organizationId,
          addressLine: dto.addressLine,
          city: dto.city,
          state: dto.state,
          country: dto.country ?? 'IN',
          postalCode: dto.postalCode,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          isPlatformHub: dto.isPlatformHub ?? false,
          status,
          isActive: status === MasterStatus.ACTIVE,
        },
        include: { location: true },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Warehouse code already exists');
    }
  }

  async findAll(query: WarehouseQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.WarehouseWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.locationId) where.locationId = query.locationId;
    if (query.organizationId) where.organizationId = query.organizationId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { city: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.warehouse.count({ where }),
      this.prisma.warehouse.findMany({
        where,
        include: { location: true },
        orderBy: { name: query.sortOrder === 'desc' ? 'desc' : 'asc' },
        skip,
        take,
      }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    return assertFound(
      await this.prisma.warehouse.findFirst({
        where: { id, deletedAt: null },
        include: { location: true },
      }),
      'Warehouse not found',
    );
  }

  async update(id: string, dto: UpdateWarehouseDto) {
    await this.findOne(id);
    try {
      return await this.prisma.warehouse.update({
        where: { id },
        data: {
          code: dto.code?.trim().toUpperCase(),
          name: dto.name?.trim(),
          description: dto.description,
          locationId: dto.locationId,
          organizationId: dto.organizationId,
          addressLine: dto.addressLine,
          city: dto.city,
          state: dto.state,
          country: dto.country,
          postalCode: dto.postalCode,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          isPlatformHub: dto.isPlatformHub,
          status: dto.status,
          isActive:
            dto.status === undefined
              ? undefined
              : dto.status === MasterStatus.ACTIVE,
        },
        include: { location: true },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Warehouse code already exists');
    }
  }

  async softDelete(id: string) {
    await this.findOne(id);
    await this.prisma.warehouse.update({
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
