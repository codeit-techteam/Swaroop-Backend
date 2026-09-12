import { Injectable } from '@nestjs/common';
import {
  DriverStatus,
  Prisma,
  type Driver,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { LogisticsException } from '../common/logistics.errors.js';
import { toSellerDriver } from '../common/blind-logistics.mapper.js';

export type CreateDriverInput = {
  name: string;
  phone?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
};

export type UpdateDriverInput = Partial<CreateDriverInput> & {
  status?: DriverStatus;
};

@Injectable()
export class DriverService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    organizationId: string | null,
    input: CreateDriverInput,
  ): Promise<Driver> {
    return this.prisma.driver.create({
      data: {
        organizationId: organizationId ?? undefined,
        name: input.name.trim(),
        phone: input.phone,
        licenseNumber: input.licenseNumber,
        licenseExpiry: parseDate(input.licenseExpiry),
        status: DriverStatus.AVAILABLE,
      },
    });
  }

  async update(
    id: string,
    input: UpdateDriverInput,
    opts?: { organizationId?: string },
  ): Promise<Driver> {
    await this.requireDriver(id, opts?.organizationId);
    return this.prisma.driver.update({
      where: { id },
      data: {
        ...(input.name != null ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.licenseNumber !== undefined
          ? { licenseNumber: input.licenseNumber }
          : {}),
        ...(input.licenseExpiry !== undefined
          ? { licenseExpiry: parseDate(input.licenseExpiry) }
          : {}),
        ...(input.status != null ? { status: input.status } : {}),
      },
    });
  }

  async list(params: { organizationId?: string; skip: number; take: number }) {
    const where: Prisma.DriverWhereInput = {
      deletedAt: null,
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.driver.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      this.prisma.driver.count({ where }),
    ]);
    return { items, total };
  }

  async get(id: string, organizationId?: string) {
    return this.requireDriver(id, organizationId);
  }

  async requireDriver(id: string, organizationId?: string) {
    const driver = await this.prisma.driver.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(organizationId ? { organizationId } : {}),
      },
    });
    if (!driver) {
      throw new LogisticsException('DRIVER_NOT_FOUND');
    }
    return driver;
  }

  assertAssignable(driver: Driver): void {
    if (driver.status === DriverStatus.INACTIVE) {
      throw new LogisticsException('DRIVER_NOT_FOUND', 'Driver is inactive');
    }
    if (driver.licenseExpiry && driver.licenseExpiry.getTime() < Date.now()) {
      throw new LogisticsException('DRIVER_LICENSE_EXPIRED');
    }
  }

  toView(d: Driver) {
    return toSellerDriver(d);
  }
}

function parseDate(value?: string | null): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return new Date(value);
}
