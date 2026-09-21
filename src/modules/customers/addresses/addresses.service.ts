import { Injectable } from '@nestjs/common';
import {
  AddressType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
} from './addresses.dto.js';
import { AddressException } from './addresses.errors.js';
import {
  isDuplicateAddress,
  MAX_CUSTOMER_ADDRESSES,
  toAddressDto,
  toCoordinate,
  type CustomerAddressDto,
} from './addresses.mapper.js';

@Injectable()
export class CustomerAddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
  ) {}

  private async ctx(userId: string) {
    return this.customerContext.requireCustomer(userId);
  }

  private decimal(value?: number | null) {
    if (value == null || !Number.isFinite(value)) {
      return undefined;
    }
    return new Prisma.Decimal(value);
  }

  async list(userId: string): Promise<CustomerAddressDto[]> {
    const ctx = await this.ctx(userId);
    const rows = await this.prisma.address.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        isActive: true,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toAddressDto);
  }

  async get(userId: string, id: string): Promise<CustomerAddressDto> {
    const ctx = await this.ctx(userId);
    const row = await this.prisma.address.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
    });
    if (!row) {
      throw new AddressException(
        'ADDRESS_NOT_FOUND',
        'Delivery address was not found.',
      );
    }
    return toAddressDto(row);
  }

  async create(
    userId: string,
    dto: CreateCustomerAddressDto,
  ): Promise<CustomerAddressDto> {
    const ctx = await this.ctx(userId);
    const existing = await this.prisma.address.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    if (existing.length >= MAX_CUSTOMER_ADDRESSES) {
      throw new AddressException(
        'ADDRESS_LIMIT_REACHED',
        `You can save up to ${MAX_CUSTOMER_ADDRESSES} delivery addresses.`,
      );
    }

    const incoming = {
      line1: dto.line1,
      postalCode: dto.postalCode,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
    };
    const duplicate = existing.find((row) =>
      isDuplicateAddress(incoming, {
        line1: row.line1,
        postalCode: row.postalCode,
        latitude: toCoordinate(row.latitude),
        longitude: toCoordinate(row.longitude),
      }),
    );
    if (duplicate) {
      return this.update(userId, duplicate.id, {
        ...dto,
        isDefault: dto.isDefault ?? duplicate.isDefault,
      });
    }

    const makeDefault = dto.isDefault === true || existing.length === 0;

    const created = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          organizationId: ctx.organizationId,
          type: dto.type ?? AddressType.SHIPPING,
          label: dto.label?.trim() || dto.city,
          line1: dto.line1.trim(),
          line2: dto.line2?.trim() || null,
          city: dto.city.trim(),
          state: dto.state.trim(),
          country: dto.country?.trim() || 'IN',
          postalCode: dto.postalCode.trim(),
          landmark: dto.landmark?.trim() || null,
          latitude: this.decimal(dto.latitude),
          longitude: this.decimal(dto.longitude),
          isDefault: makeDefault,
          isActive: true,
        },
      });
    });

    return toAddressDto(created);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateCustomerAddressDto,
  ): Promise<CustomerAddressDto> {
    const ctx = await this.ctx(userId);
    const current = await this.prisma.address.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
    });
    if (!current) {
      throw new AddressException(
        'ADDRESS_NOT_FOUND',
        'Delivery address was not found.',
      );
    }

    const makeDefault = dto.isDefault === true;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            isDefault: true,
            NOT: { id },
          },
          data: { isDefault: false },
        });
      }

      return tx.address.update({
        where: { id },
        data: {
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.label !== undefined
            ? { label: dto.label.trim() || current.city }
            : {}),
          ...(dto.line1 !== undefined ? { line1: dto.line1.trim() } : {}),
          ...(dto.line2 !== undefined ? { line2: dto.line2?.trim() || null } : {}),
          ...(dto.city !== undefined ? { city: dto.city.trim() } : {}),
          ...(dto.state !== undefined ? { state: dto.state.trim() } : {}),
          ...(dto.country !== undefined
            ? { country: dto.country.trim() || 'IN' }
            : {}),
          ...(dto.postalCode !== undefined
            ? { postalCode: dto.postalCode.trim() }
            : {}),
          ...(dto.landmark !== undefined
            ? { landmark: dto.landmark?.trim() || null }
            : {}),
          ...(dto.latitude !== undefined
            ? { latitude: this.decimal(dto.latitude) ?? null }
            : {}),
          ...(dto.longitude !== undefined
            ? { longitude: this.decimal(dto.longitude) ?? null }
            : {}),
          ...(makeDefault ? { isDefault: true } : {}),
        },
      });
    });

    return toAddressDto(updated);
  }

  async remove(userId: string, id: string): Promise<{ id: string }> {
    const ctx = await this.ctx(userId);
    const current = await this.prisma.address.findFirst({
      where: {
        id,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
    });
    if (!current) {
      throw new AddressException(
        'ADDRESS_NOT_FOUND',
        'Delivery address was not found.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({
        where: { id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          isDefault: false,
        },
      });

      if (current.isDefault) {
        const nextDefault = await tx.address.findFirst({
          where: {
            organizationId: ctx.organizationId,
            deletedAt: null,
            isActive: true,
          },
          orderBy: { createdAt: 'asc' },
        });
        if (nextDefault) {
          await tx.address.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
      }
    });

    return { id };
  }

  async setDefault(userId: string, id: string): Promise<CustomerAddressDto> {
    return this.update(userId, id, { isDefault: true });
  }
}
