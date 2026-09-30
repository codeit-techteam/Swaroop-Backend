import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  isValidCoordinate,
  isWithinIndia,
} from '../../locations/location-normalizer.js';
import { haversineMeters } from '../../organizations/addresses/address-book.mapper.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import { SellerContextService } from '../common/seller-context.service.js';
import type {
  SaveLocationFromGeoDto,
  SetCurrentLocationDto,
} from '../offers/offers.dto.js';

/** Saving within this radius of an existing warehouse updates it instead of duplicating. */
const WAREHOUSE_DEDUPE_METERS = 75;

const warehouseSelect = {
  id: true,
  code: true,
  name: true,
  city: true,
  state: true,
  country: true,
  postalCode: true,
  addressLine: true,
  latitude: true,
  longitude: true,
  placeId: true,
  formattedAddress: true,
  isActive: true,
  contactName: true,
} as const;

type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string;
  postalCode: string | null;
  addressLine?: string | null;
  latitude?: Prisma.Decimal | null;
  longitude?: Prisma.Decimal | null;
  placeId?: string | null;
  formattedAddress?: string | null;
  isActive: boolean;
  contactName?: string | null;
};

type SellerProfileMetadata = {
  currentWarehouseId?: string;
  [key: string]: unknown;
};

type LocationRow = {
  id: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string;
  pincode: string | null;
  addressLine: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  status: 'active' | 'inactive';
  availableStockMt: number;
  activeOffers: number;
  source: 'warehouse' | 'onboarding' | 'saved';
  decisionMaker?: string | null;
  decisionMakerRole?: string | null;
};

type OnboardingLocationPayload = {
  warehouseAddress?: unknown;
  registeredAddress?: unknown;
  city?: unknown;
  state?: unknown;
  pincode?: unknown;
  additionalAddresses?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  contactName?: unknown;
  contactPhone?: unknown;
  warehouseName?: unknown;
};

@Injectable()
export class SellerLocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
  ) {}

  private readMetadata(metadata: unknown): SellerProfileMetadata {
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      return metadata as SellerProfileMetadata;
    }
    return {};
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private str(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private coord(value: Prisma.Decimal | null | undefined): number | null {
    if (value == null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  private mapWarehouse(row: WarehouseRow): LocationRow {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      city: row.city,
      state: row.state,
      country: row.country,
      pincode: row.postalCode,
      addressLine: row.addressLine ?? null,
      formattedAddress: row.formattedAddress ?? null,
      latitude: this.coord(row.latitude),
      longitude: this.coord(row.longitude),
      placeId: row.placeId ?? null,
      status: row.isActive ? 'active' : 'inactive',
      availableStockMt: 0,
      activeOffers: 0,
      source: 'warehouse',
      decisionMaker: row.contactName ?? null,
      decisionMakerRole: row.contactName ? 'Location contact' : null,
    };
  }

  /**
   * Ensure the seller has at least one warehouse derived from onboarding
   * / saved location data so the ERP header can always show a location.
   */
  private async ensureWarehouseFromOnboarding(
    organizationId: string,
    sellerProfileId: string,
  ): Promise<LocationRow | null> {
    const onboarding = await this.prisma.sellerOnboarding.findUnique({
      where: { sellerProfileId },
      select: { locationData: true, addressData: true },
    });
    const location = this.asRecord(onboarding?.locationData) as OnboardingLocationPayload;
    const address = this.asRecord(onboarding?.addressData);

    const city =
      this.str(location.city) ||
      this.str(address.city) ||
      '';
    const state =
      this.str(location.state) ||
      this.str(address.state) ||
      '';
    const pincode =
      this.str(location.pincode) ||
      this.str(address.postalCode) ||
      '';
    const addressLine =
      this.str(location.warehouseAddress) ||
      this.str(location.registeredAddress) ||
      this.str(address.line1) ||
      '';
    const warehouseName =
      this.str(location.warehouseName) ||
      (city ? `${city} Warehouse` : '') ||
      (addressLine ? addressLine.slice(0, 80) : '') ||
      'Primary Warehouse';

    if (!city && !addressLine && !state) {
      return null;
    }

    const existing = await this.prisma.warehouse.findFirst({
      where: {
        organizationId,
        deletedAt: null,
        OR: [
          { name: { equals: warehouseName, mode: 'insensitive' } },
          ...(city
            ? [{ city: { equals: city, mode: 'insensitive' as const } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      return this.mapWarehouse(existing);
    }

    const codeBase = (city || warehouseName || 'SELLER')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20);
    const code = `WH-${codeBase}-${Date.now().toString(36).toUpperCase()}`;

    const created = await this.prisma.warehouse.create({
      data: {
        organizationId,
        code,
        name: warehouseName,
        city: city || null,
        state: state || null,
        country: 'IN',
        postalCode: pincode || null,
        addressLine: addressLine || null,
        contactName: this.str(location.contactName) || null,
        contactPhone: this.str(location.contactPhone) || null,
        ...(isValidCoordinate(location.latitude, location.longitude)
          ? {
              latitude: new Prisma.Decimal(
                Number(location.latitude).toFixed(7),
              ),
              longitude: new Prisma.Decimal(
                Number(location.longitude).toFixed(7),
              ),
            }
          : {}),
        isPlatformHub: false,
        isActive: true,
        metadata: {
          source: 'seller_onboarding',
          latitude: location.latitude ?? null,
          longitude: location.longitude ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      ...this.mapWarehouse(created),
      source: 'onboarding',
    };
  }

  async list(userId: string): Promise<LocationRow[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phone: true, firstName: true, lastName: true },
    });
    const ctx = await this.sellerContext.getOrCreateDraftSeller(userId, {
      companyName:
        [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
        'Seller Organization',
      email: user?.email,
      phone: user?.phone,
    });

    const [orgWarehouses, inventoryRows, offerCounts] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: {
          deletedAt: null,
          organizationId: ctx.organizationId,
        },
        orderBy: { name: 'asc' },
        select: warehouseSelect,
      }),
      this.prisma.inventory.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null },
        select: {
          availableQty: true,
          reservedQty: true,
          warehouseId: true,
          warehouse: { select: warehouseSelect },
        },
      }),
      this.prisma.offer.groupBy({
        by: ['warehouseId'],
        where: {
          organizationId: ctx.organizationId,
          deletedAt: null,
          warehouseId: { not: null },
        },
        _count: { _all: true },
      }),
    ]);

    const offerCountByWarehouse = new Map(
      offerCounts.map((row) => [row.warehouseId as string, row._count._all]),
    );

    const groups = new Map<string, LocationRow>();

    for (const warehouse of orgWarehouses) {
      groups.set(warehouse.id, {
        ...this.mapWarehouse(warehouse),
        activeOffers: offerCountByWarehouse.get(warehouse.id) ?? 0,
        source: 'saved',
      });
    }

    for (const row of inventoryRows) {
      const warehouse = row.warehouse;
      if (!warehouse) continue;
      const current = groups.get(warehouse.id) ?? {
        ...this.mapWarehouse(warehouse),
        activeOffers: offerCountByWarehouse.get(warehouse.id) ?? 0,
        source: 'warehouse' as const,
      };
      current.availableStockMt +=
        Number(row.availableQty) + Number(row.reservedQty);
      current.activeOffers =
        offerCountByWarehouse.get(warehouse.id) ?? current.activeOffers;
      groups.set(warehouse.id, current);
    }

    // Warehouses with offers but no org ownership / inventory yet
    const orphanOfferIds = [...offerCountByWarehouse.keys()].filter(
      (id) => !groups.has(id),
    );
    if (orphanOfferIds.length) {
      const orphanWarehouses = await this.prisma.warehouse.findMany({
        where: { id: { in: orphanOfferIds }, deletedAt: null },
        select: warehouseSelect,
      });
      for (const warehouse of orphanWarehouses) {
        groups.set(warehouse.id, {
          ...this.mapWarehouse(warehouse),
          activeOffers: offerCountByWarehouse.get(warehouse.id) ?? 0,
          source: 'warehouse',
        });
      }
    }

    if (!groups.size) {
      const ensured = await this.ensureWarehouseFromOnboarding(
        ctx.organizationId,
        ctx.sellerProfileId,
      );
      if (ensured) {
        groups.set(ensured.id, ensured);
      }
    }

    return [...groups.values()].sort((a, b) => {
      const aLabel = (a.city || a.name).localeCompare(b.city || b.name);
      return aLabel;
    });
  }

  /** Validates a resolved location before it becomes a seller operating location. */
  private assertLocation(dto: SaveLocationFromGeoDto) {
    if (!isValidCoordinate(dto.latitude, dto.longitude)) {
      throw new BadRequestException({
        code: 'INVALID_COORDINATES',
        message: 'The selected location coordinates are invalid.',
      });
    }
    const country = this.str(dto.country).toUpperCase() || 'IN';
    if (country === 'IN' && !isWithinIndia(dto.latitude, dto.longitude)) {
      throw new BadRequestException({
        code: 'COORDINATES_OUTSIDE_REGION',
        message: 'The selected location is outside India.',
      });
    }
    const pincode = this.str(dto.pincode);
    if (pincode && !/^[1-9][0-9]{5}$/.test(pincode)) {
      throw new BadRequestException({
        code: 'INVALID_PIN',
        message: 'Enter a valid 6-digit Indian PIN code.',
      });
    }
  }

  async saveFromGeo(userId: string, dto: SaveLocationFromGeoDto) {
    this.assertLocation(dto);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, phone: true, firstName: true, lastName: true },
    });
    const ctx = await this.sellerContext.getOrCreateDraftSeller(userId, {
      companyName:
        [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
        'Seller Organization',
      email: user?.email,
      phone: user?.phone,
    });

    const city = this.str(dto.city);
    const state = this.str(dto.state);
    const pincode = this.str(dto.pincode);
    const addressLine = [this.str(dto.addressLine), this.str(dto.addressLine2)]
      .filter(Boolean)
      .join(', ');
    const placeId = this.str(dto.placeId) || null;
    const formattedAddress = this.str(dto.formattedAddress) || null;
    const warehouseName =
      this.str(dto.name) ||
      (city ? `${city} Warehouse` : addressLine.slice(0, 80) || 'Warehouse');

    const candidates = await this.prisma.warehouse.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, placeId: true, latitude: true, longitude: true },
    });
    const duplicate = candidates.find((row) => {
      if (placeId && row.placeId === placeId) return true;
      const lat = this.coord(row.latitude);
      const lng = this.coord(row.longitude);
      return (
        lat != null &&
        lng != null &&
        haversineMeters(lat, lng, dto.latitude, dto.longitude) <=
          WAREHOUSE_DEDUPE_METERS
      );
    });

    const locationData = {
      name: warehouseName,
      city: city || null,
      state: state || null,
      country: this.str(dto.country).toUpperCase() || 'IN',
      postalCode: pincode || null,
      addressLine: addressLine || null,
      latitude: new Prisma.Decimal(dto.latitude.toFixed(7)),
      longitude: new Prisma.Decimal(dto.longitude.toFixed(7)),
      placeId,
      formattedAddress,
    };
    const metadata = {
      source: dto.source ?? 'GPS',
      accuracyMeters: dto.accuracyMeters ?? null,
      landmark: this.str(dto.landmark) || null,
      locality: this.str(dto.locality) || null,
      district: this.str(dto.district) || null,
    };

    const saved = duplicate
      ? await this.prisma.warehouse.update({
          where: { id: duplicate.id },
          data: { ...locationData, isActive: true },
        })
      : await this.prisma.warehouse.create({
          data: {
            organizationId: ctx.organizationId,
            code: `WH-GEO-${Date.now().toString(36).toUpperCase()}`,
            ...locationData,
            isPlatformHub: false,
            isActive: true,
            metadata: metadata as Prisma.InputJsonValue,
          },
        });

    const profile = await this.prisma.sellerProfile.findUnique({
      where: { id: ctx.sellerProfileId },
      select: { metadata: true },
    });
    const profileMetadata = this.readMetadata(profile?.metadata);
    profileMetadata.currentWarehouseId = saved.id;
    await this.prisma.sellerProfile.update({
      where: { id: ctx.sellerProfileId },
      data: { metadata: profileMetadata as Prisma.InputJsonValue },
    });

    await this.audit.log({
      action: 'SELLER_LOCATION_FROM_GEO',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityId: saved.id,
      newData: {
        warehouseId: saved.id,
        reusedExisting: Boolean(duplicate),
        latitude: dto.latitude,
        longitude: dto.longitude,
        placeId,
        city,
        source: metadata.source,
      },
    });

    return this.current(userId);
  }

  async current(userId: string) {
    const locations = await this.list(userId);
    const ctx = await this.sellerContext.getOrCreateDraftSeller(userId);
    const profile = await this.prisma.sellerProfile.findUnique({
      where: { id: ctx.sellerProfileId },
      select: { metadata: true },
    });
    const metadata = this.readMetadata(profile?.metadata);
    const preferredId = metadata.currentWarehouseId;
    let current =
      locations.find((loc) => loc.id === preferredId) ?? locations[0] ?? null;

    // Persist default current location so subsequent loads are stable.
    if (current && !preferredId) {
      metadata.currentWarehouseId = current.id;
      await this.prisma.sellerProfile.update({
        where: { id: ctx.sellerProfileId },
        data: { metadata: metadata as Prisma.InputJsonValue },
      });
    }

    return {
      current,
      locations,
      source: preferredId
        ? 'profile'
        : current
          ? current.source === 'onboarding'
            ? 'onboarding'
            : 'default'
          : 'empty',
    };
  }

  async setCurrent(userId: string, dto: SetCurrentLocationDto) {
    const ctx = await this.sellerContext.getOrCreateDraftSeller(userId);
    const locations = await this.list(userId);
    const target = locations.find((loc) => loc.id === dto.warehouseId);
    if (!target) {
      const warehouse = await this.prisma.warehouse.findFirst({
        where: {
          id: dto.warehouseId,
          deletedAt: null,
          OR: [
            { organizationId: ctx.organizationId },
            { organizationId: null },
          ],
        },
      });
      if (!warehouse) {
        throw new BadRequestException(
          'Warehouse is not assigned to this seller',
        );
      }
    }

    const profile = await this.prisma.sellerProfile.findUnique({
      where: { id: ctx.sellerProfileId },
    });
    if (!profile) throw new NotFoundException('Seller profile not found');

    const metadata = this.readMetadata(profile.metadata);
    const previousWarehouseId = metadata.currentWarehouseId;
    metadata.currentWarehouseId = dto.warehouseId;

    await this.prisma.sellerProfile.update({
      where: { id: ctx.sellerProfileId },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });

    await this.audit.log({
      action: 'SELLER_CURRENT_LOCATION_CHANGED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityId: ctx.sellerProfileId,
      previousData: { currentWarehouseId: previousWarehouseId },
      newData: { currentWarehouseId: dto.warehouseId },
    });

    return this.current(userId);
  }
}
