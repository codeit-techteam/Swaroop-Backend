import { Injectable } from '@nestjs/common';
import {
  type Address,
  AddressType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  isValidCoordinate,
  isWithinIndia,
} from '../../locations/location-normalizer.js';
import {
  type AddressSource,
  type CreateAddressBookEntryDto,
  GEO_ADDRESS_SOURCES,
  type UpdateAddressBookEntryDto,
} from './address-book.dto.js';
import { AddressException } from './address-book.errors.js';
import {
  type AddressBookEntryDto,
  type AddressSnapshot,
  buildAddressSnapshot,
  isDuplicateAddress,
  MAX_ORGANIZATION_ADDRESSES,
  normalizeCountryCode,
  toAddressBookDto,
  toCoordinate,
} from './address-book.mapper.js';

type Tx = Prisma.TransactionClient | PrismaService;

function optionalText(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Organization-scoped address book shared by Customer and Seller organizations.
 * Callers must pass an organizationId derived from the authenticated session.
 */
@Injectable()
export class AddressBookService {
  constructor(private readonly prisma: PrismaService) {}

  private decimal(value?: number | null) {
    if (value == null || !Number.isFinite(value)) {
      return null;
    }
    return new Prisma.Decimal(value);
  }

  /** Server-side validation of the merged (persisted + incoming) address. */
  private assertValidLocation(merged: {
    latitude: number | null;
    longitude: number | null;
    country: string;
    source: string | null;
  }) {
    const hasLat = merged.latitude != null;
    const hasLng = merged.longitude != null;
    if (hasLat !== hasLng) {
      throw new AddressException(
        'INVALID_COORDINATES',
        'Latitude and longitude must be provided together.',
      );
    }
    if (hasLat && hasLng) {
      if (!isValidCoordinate(merged.latitude, merged.longitude)) {
        throw new AddressException(
          'INVALID_COORDINATES',
          'The selected location coordinates are invalid.',
        );
      }
      if (
        merged.country === 'IN' &&
        !isWithinIndia(merged.latitude!, merged.longitude!)
      ) {
        throw new AddressException(
          'COORDINATES_OUTSIDE_REGION',
          'The selected location is outside India. Please choose an Indian delivery address.',
        );
      }
    }
    if (
      merged.source &&
      GEO_ADDRESS_SOURCES.has(merged.source as AddressSource) &&
      !hasLat
    ) {
      throw new AddressException(
        'ADDRESS_INCOMPLETE',
        'Location coordinates are missing. Please search or detect the location again.',
      );
    }
  }

  async list(organizationId: string): Promise<AddressBookEntryDto[]> {
    const rows = await this.prisma.address.findMany({
      where: { organizationId, deletedAt: null, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toAddressBookDto);
  }

  private async findOwned(
    organizationId: string,
    id: string,
    client: Tx = this.prisma,
  ): Promise<Address> {
    const row = await client.address.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!row) {
      throw new AddressException('ADDRESS_NOT_FOUND', 'Address was not found.');
    }
    return row;
  }

  async get(organizationId: string, id: string): Promise<AddressBookEntryDto> {
    return toAddressBookDto(await this.findOwned(organizationId, id));
  }

  async create(
    organizationId: string,
    dto: CreateAddressBookEntryDto,
    defaults: { type?: AddressType } = {},
  ): Promise<AddressBookEntryDto> {
    const country = normalizeCountryCode(dto.country);
    this.assertValidLocation({
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      country,
      source: dto.source ?? null,
    });

    const existing = await this.prisma.address.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    const duplicate = existing.find(
      (row) =>
        (dto.placeId &&
          row.placeId === dto.placeId &&
          row.line1 === dto.line1) ||
        isDuplicateAddress(
          {
            line1: dto.line1,
            postalCode: dto.postalCode,
            latitude: dto.latitude ?? null,
            longitude: dto.longitude ?? null,
          },
          {
            line1: row.line1,
            postalCode: row.postalCode,
            latitude: toCoordinate(row.latitude),
            longitude: toCoordinate(row.longitude),
          },
        ),
    );
    if (duplicate) {
      return this.update(organizationId, duplicate.id, {
        ...dto,
        isDefault: dto.isDefault ?? duplicate.isDefault,
      });
    }

    if (existing.length >= MAX_ORGANIZATION_ADDRESSES) {
      throw new AddressException(
        'ADDRESS_LIMIT_REACHED',
        `You can save up to ${MAX_ORGANIZATION_ADDRESSES} addresses.`,
      );
    }

    const makeDefault = dto.isDefault === true || existing.length === 0;

    const created = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({
          where: { organizationId, deletedAt: null, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          organizationId,
          type: dto.type ?? defaults.type ?? AddressType.SHIPPING,
          label: dto.label?.trim() || dto.city.trim(),
          line1: dto.line1.trim(),
          line2: optionalText(dto.line2),
          city: dto.city.trim(),
          state: dto.state.trim(),
          country,
          postalCode: dto.postalCode.trim(),
          landmark: optionalText(dto.landmark),
          locality: optionalText(dto.locality),
          district: optionalText(dto.district),
          latitude: this.decimal(dto.latitude),
          longitude: this.decimal(dto.longitude),
          placeId: optionalText(dto.placeId),
          formattedAddress: optionalText(dto.formattedAddress),
          accuracyMeters: dto.accuracyMeters ?? null,
          source: dto.source ?? 'MANUAL',
          isDefault: makeDefault,
          isActive: true,
        },
      });
    });

    return toAddressBookDto(created);
  }

  async update(
    organizationId: string,
    id: string,
    dto: UpdateAddressBookEntryDto,
  ): Promise<AddressBookEntryDto> {
    const current = await this.findOwned(organizationId, id);
    const country =
      dto.country !== undefined
        ? normalizeCountryCode(dto.country)
        : current.country;
    this.assertValidLocation({
      latitude:
        dto.latitude !== undefined
          ? (dto.latitude ?? null)
          : toCoordinate(current.latitude),
      longitude:
        dto.longitude !== undefined
          ? (dto.longitude ?? null)
          : toCoordinate(current.longitude),
      country,
      source: dto.source !== undefined ? dto.source : current.source,
    });

    const makeDefault = dto.isDefault === true;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({
          where: {
            organizationId,
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
          ...(dto.line2 !== undefined
            ? { line2: optionalText(dto.line2) }
            : {}),
          ...(dto.city !== undefined ? { city: dto.city.trim() } : {}),
          ...(dto.state !== undefined ? { state: dto.state.trim() } : {}),
          ...(dto.country !== undefined ? { country } : {}),
          ...(dto.postalCode !== undefined
            ? { postalCode: dto.postalCode.trim() }
            : {}),
          ...(dto.landmark !== undefined
            ? { landmark: optionalText(dto.landmark) }
            : {}),
          ...(dto.locality !== undefined
            ? { locality: optionalText(dto.locality) }
            : {}),
          ...(dto.district !== undefined
            ? { district: optionalText(dto.district) }
            : {}),
          ...(dto.latitude !== undefined
            ? { latitude: this.decimal(dto.latitude) }
            : {}),
          ...(dto.longitude !== undefined
            ? { longitude: this.decimal(dto.longitude) }
            : {}),
          ...(dto.placeId !== undefined
            ? { placeId: optionalText(dto.placeId) }
            : {}),
          ...(dto.formattedAddress !== undefined
            ? { formattedAddress: optionalText(dto.formattedAddress) }
            : {}),
          ...(dto.accuracyMeters !== undefined
            ? { accuracyMeters: dto.accuracyMeters ?? null }
            : {}),
          ...(dto.source !== undefined ? { source: dto.source } : {}),
          ...(makeDefault ? { isDefault: true } : {}),
        },
      });
    });

    return toAddressBookDto(updated);
  }

  async remove(organizationId: string, id: string): Promise<{ id: string }> {
    const current = await this.findOwned(organizationId, id);

    await this.prisma.$transaction(async (tx) => {
      await tx.address.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, isDefault: false },
      });

      if (current.isDefault) {
        const nextDefault = await tx.address.findFirst({
          where: { organizationId, deletedAt: null, isActive: true },
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

  async setDefault(
    organizationId: string,
    id: string,
  ): Promise<AddressBookEntryDto> {
    return this.update(organizationId, id, { isDefault: true });
  }

  /** Ownership-checked snapshot for transactional records (PR / PO). */
  async snapshot(
    organizationId: string,
    id: string | null | undefined,
    client: Tx = this.prisma,
  ): Promise<AddressSnapshot | null> {
    if (!id) return null;
    const row = await client.address.findFirst({
      where: { id, organizationId, deletedAt: null, isActive: true },
    });
    if (!row) {
      throw new AddressException(
        'ADDRESS_NOT_FOUND',
        'Address not found for this organization.',
      );
    }
    return buildAddressSnapshot(row);
  }
}
