import { Injectable } from '@nestjs/common';
import {
  LocationType,
  MasterStatus,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { paginationMeta, skipTake } from '../common/pagination.js';
import { assertFound, handlePrismaUnique } from '../common/prisma-helpers.js';
import type {
  CreateLocationDto,
  LocationQueryDto,
  UpdateLocationDto,
} from './locations.dto.js';

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateLocationDto) {
    if (dto.parentId) {
      await assertFound(
        await this.prisma.location.findFirst({
          where: { id: dto.parentId, deletedAt: null },
        }),
        'Parent location not found',
      );
    }
    try {
      return await this.prisma.location.create({
        data: {
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          type: dto.type,
          parentId: dto.parentId,
          countryCode: dto.countryCode,
          stateCode: dto.stateCode,
          pincode: dto.pincode,
          latitude: dto.latitude,
          longitude: dto.longitude,
          status: dto.status ?? MasterStatus.ACTIVE,
        },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Location code already exists');
    }
  }

  async findAll(query: LocationQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.LocationWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.parentId) where.parentId = query.parentId;
    if (query.countryCode) where.countryCode = query.countryCode;
    if (query.stateCode) where.stateCode = query.stateCode;
    if (query.pincode) where.pincode = query.pincode;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { code: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { pincode: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.location.count({ where }),
      this.prisma.location.findMany({
        where,
        orderBy: { name: query.sortOrder === 'desc' ? 'desc' : 'asc' },
        skip,
        take,
      }),
    ]);
    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findCountries() {
    return this.prisma.location.findMany({
      where: {
        deletedAt: null,
        status: MasterStatus.ACTIVE,
        type: LocationType.COUNTRY,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findStates(countryId: string) {
    return this.prisma.location.findMany({
      where: {
        deletedAt: null,
        status: MasterStatus.ACTIVE,
        type: LocationType.STATE,
        parentId: countryId,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findCities(stateId: string) {
    return this.prisma.location.findMany({
      where: {
        deletedAt: null,
        status: MasterStatus.ACTIVE,
        type: LocationType.CITY,
        parentId: stateId,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    return assertFound(
      await this.prisma.location.findFirst({ where: { id, deletedAt: null } }),
      'Location not found',
    );
  }

  async update(id: string, dto: UpdateLocationDto) {
    await this.findOne(id);
    try {
      return await this.prisma.location.update({
        where: { id },
        data: {
          code: dto.code?.trim().toUpperCase(),
          name: dto.name?.trim(),
          type: dto.type,
          parentId: dto.parentId,
          countryCode: dto.countryCode,
          stateCode: dto.stateCode,
          pincode: dto.pincode,
          latitude: dto.latitude,
          longitude: dto.longitude,
          status: dto.status,
        },
      });
    } catch (error) {
      handlePrismaUnique(error, 'Location code already exists');
    }
  }

  async softDelete(id: string) {
    await this.findOne(id);
    await this.prisma.location.update({
      where: { id },
      data: { deletedAt: new Date(), status: MasterStatus.INACTIVE },
    });
    return { id, deleted: true };
  }
}
