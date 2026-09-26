import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import { SellerContextService } from '../common/seller-context.service.js';
import type { SetCurrentLocationDto } from '../offers/offers.dto.js';

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

  private mapWarehouse(row: {
    id: string;
    code: string;
    name: string;
    city: string | null;
    state: string | null;
    country: string;
    postalCode: string | null;
    isActive: boolean;
    contactName?: string | null;
  }): LocationRow {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      city: row.city,
      state: row.state,
      country: row.country,
      pincode: row.postalCode,
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
        select: {
          id: true,
          code: true,
          name: true,
          city: true,
          state: true,
          country: true,
          postalCode: true,
          isActive: true,
          contactName: true,
        },
      }),
      this.prisma.inventory.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null },
        select: {
          availableQty: true,
          reservedQty: true,
          warehouseId: true,
          warehouse: {
            select: {
              id: true,
              code: true,
              name: true,
              city: true,
              state: true,
              country: true,
              postalCode: true,
              isActive: true,
              contactName: true,
            },
          },
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
        select: {
          id: true,
          code: true,
          name: true,
          city: true,
          state: true,
          country: true,
          postalCode: true,
          isActive: true,
          contactName: true,
        },
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

    if (!groups.size) {
      const fallback = await this.ensureDefaultWarehouse(ctx.organizationId);
      groups.set(fallback.id, fallback);
    }

    return [...groups.values()].sort((a, b) => {
      const aLabel = (a.city || a.name).localeCompare(b.city || b.name);
      return aLabel;
    });
  }

  private async ensureDefaultWarehouse(
    organizationId: string,
  ): Promise<LocationRow> {
    const existing = await this.prisma.warehouse.findFirst({
      where: { organizationId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return this.mapWarehouse(existing);

    const created = await this.prisma.warehouse.create({
      data: {
        organizationId,
        code: `WH-PRIMARY-${Date.now().toString(36).toUpperCase()}`,
        name: 'Primary Warehouse',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'IN',
        postalCode: '400069',
        addressLine: 'Primary operating location',
        isPlatformHub: false,
        isActive: true,
        metadata: { source: 'auto_default' } as Prisma.InputJsonValue,
      },
    });
    return { ...this.mapWarehouse(created), source: 'saved' };
  }

  async saveFromGeo(
    userId: string,
    dto: {
      latitude: number;
      longitude: number;
      name?: string;
      addressLine?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
    },
  ) {
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

    const city = this.str(dto.city) || 'Current location';
    const state = this.str(dto.state);
    const pincode = this.str(dto.pincode);
    const addressLine = this.str(dto.addressLine);
    const warehouseName =
      this.str(dto.name) ||
      (city ? `${city} Warehouse` : 'Current location warehouse');

    const code = `WH-GEO-${Date.now().toString(36).toUpperCase()}`;
    const created = await this.prisma.warehouse.create({
      data: {
        organizationId: ctx.organizationId,
        code,
        name: warehouseName,
        city: city || null,
        state: state || null,
        country: this.str(dto.country) || 'IN',
        postalCode: pincode || null,
        addressLine: addressLine || null,
        isPlatformHub: false,
        isActive: true,
        metadata: {
          source: 'geolocation',
          latitude: dto.latitude,
          longitude: dto.longitude,
        } as Prisma.InputJsonValue,
      },
    });

    const profile = await this.prisma.sellerProfile.findUnique({
      where: { id: ctx.sellerProfileId },
      select: { metadata: true },
    });
    const metadata = this.readMetadata(profile?.metadata);
    metadata.currentWarehouseId = created.id;
    await this.prisma.sellerProfile.update({
      where: { id: ctx.sellerProfileId },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });

    await this.audit.log({
      action: 'SELLER_LOCATION_FROM_GEO',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityId: created.id,
      newData: {
        warehouseId: created.id,
        latitude: dto.latitude,
        longitude: dto.longitude,
        city,
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
