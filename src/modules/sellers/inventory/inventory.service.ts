import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  InventoryStatus,
  Prisma,
  ProductStatus,
  StockMovementType,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import { handlePrismaUnique } from '../../master-data/common/prisma-helpers.js';
import { SellerAuditService } from '../common/seller-audit.service.js';
import {
  SellerContext,
  SellerContextService,
} from '../common/seller-context.service.js';
import type {
  AdjustInventoryDto,
  CreateInventoryDto,
  InventoryQueryDto,
  ReserveInventoryDto,
  StockStatusFilter,
  UpdateInventoryDto,
} from './inventory.dto.js';

const inventoryInclude = {
  product: {
    select: {
      id: true,
      code: true,
      name: true,
      gradeId: true,
      unit: true,
      status: true,
      grade: {
        select: {
          id: true,
          code: true,
          name: true,
          category: { select: { id: true, code: true, name: true } },
        },
      },
    },
  },
  warehouse: {
    select: { id: true, code: true, name: true, city: true, state: true },
  },
  offers: {
    where: { deletedAt: null },
    orderBy: { updatedAt: 'desc' as const },
    take: 1,
    select: { id: true, moq: true, basePrice: true, status: true },
  },
} satisfies Prisma.InventoryInclude;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellerContext: SellerContextService,
    private readonly audit: SellerAuditService,
  ) {}

  private async ctx(userId: string) {
    return this.sellerContext.requireSeller(userId);
  }

  private async assertOwned(ctx: SellerContext, id: string) {
    const row = await this.prisma.inventory.findFirst({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      include: inventoryInclude,
    });
    if (!row) throw new NotFoundException('Inventory not found');
    return row;
  }

  private deriveStatus(
    availableQty: number,
    minStockQty: number | null | undefined,
    explicit?: InventoryStatus,
  ): InventoryStatus {
    if (explicit) return explicit;
    if (availableQty <= 0) return InventoryStatus.OUT_OF_STOCK;
    if (minStockQty != null && availableQty <= minStockQty) {
      return InventoryStatus.LOW;
    }
    return InventoryStatus.AVAILABLE;
  }

  private mapStockStatusFilter(
    stockStatus?: StockStatusFilter,
  ): InventoryStatus | undefined {
    if (!stockStatus) return undefined;
    if (stockStatus === 'IN_STOCK' || stockStatus === 'AVAILABLE') {
      return InventoryStatus.AVAILABLE;
    }
    if (stockStatus === 'LOW_STOCK' || stockStatus === 'LOW') {
      return InventoryStatus.LOW;
    }
    if (stockStatus === 'OUT_OF_STOCK') {
      return InventoryStatus.OUT_OF_STOCK;
    }
    return undefined;
  }

  private serializeInventoryRow(
    row: Prisma.InventoryGetPayload<{ include: typeof inventoryInclude }>,
  ) {
    const availableQty = Number(row.availableQty);
    const reservedQty = Number(row.reservedQty);
    const allocatedQty = Number(row.allocatedQty);
    const minStockQty =
      row.minStockQty != null ? Number(row.minStockQty) : null;
    const offer = row.offers[0] ?? null;
    const stockStatus = this.deriveStatus(availableQty, minStockQty);

    return {
      id: row.id,
      productId: row.productId,
      gradeId: row.product.gradeId,
      gradeName: row.product.name,
      gradeCode: row.product.code,
      category:
        row.product.grade?.category?.name ??
        row.product.grade?.name ??
        'Grade',
      productStatus: row.product.status,
      warehouse: row.warehouse
        ? {
            id: row.warehouse.id,
            code: row.warehouse.code,
            name: row.warehouse.name,
            city: row.warehouse.city,
            state: row.warehouse.state,
          }
        : null,
      onHandQuantity: availableQty + reservedQty,
      sellableQuantity: availableQty,
      availableQty,
      reservedQty,
      allocatedQty,
      unit: row.unit,
      minimumOrderQuantity: offer?.moq != null ? Number(offer.moq) : null,
      lowStockThreshold: minStockQty,
      stockStatus,
      status: stockStatus,
      offerId: offer?.id ?? null,
      updatedAt: row.updatedAt,
      createdAt: row.createdAt,
      product: row.product,
    };
  }

  private buildListWhere(
    ctx: SellerContext,
    query: InventoryQueryDto,
  ): Prisma.InventoryWhereInput {
    const where: Prisma.InventoryWhereInput = {
      organizationId: ctx.organizationId,
      deletedAt: null,
    };
    const status =
      query.status ?? this.mapStockStatusFilter(query.stockStatus);
    if (status) where.status = status;
    if (query.productId) where.productId = query.productId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    const search = resolveSearch(query);
    if (search) {
      where.OR = [
        { product: { name: { contains: search, mode: 'insensitive' } } },
        { product: { code: { contains: search, mode: 'insensitive' } } },
        {
          product: {
            grade: { name: { contains: search, mode: 'insensitive' } },
          },
        },
        {
          product: {
            grade: { code: { contains: search, mode: 'insensitive' } },
          },
        },
        { warehouse: { name: { contains: search, mode: 'insensitive' } } },
        { warehouse: { code: { contains: search, mode: 'insensitive' } } },
        { warehouse: { city: { contains: search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  async create(userId: string, dto: CreateInventoryDto) {
    const ctx = await this.ctx(userId);
    const product = await this.prisma.product.findFirst({
      where: {
        id: dto.productId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
    });
    if (!product) throw new BadRequestException('Product not found for seller');

    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: dto.warehouseId,
        deletedAt: null,
        OR: [
          { organizationId: ctx.organizationId },
          { organizationId: null, isPlatformHub: true },
        ],
      },
    });
    if (!warehouse) {
      throw new BadRequestException('Warehouse not found or not accessible');
    }

    const availableQty = dto.availableQty ?? 0;
    if (availableQty < 0) {
      throw new BadRequestException('availableQty cannot be negative');
    }

    try {
      const inventory = await this.prisma.$transaction(async (tx) => {
        const created = await tx.inventory.create({
          data: {
            organizationId: ctx.organizationId,
            sellerProfileId: ctx.sellerProfileId,
            productId: dto.productId,
            warehouseId: dto.warehouseId,
            availableQty,
            minStockQty: dto.minStockQty,
            maxStockQty: dto.maxStockQty,
            unit: dto.unit ?? product.unit ?? 'MT',
            status: this.deriveStatus(
              availableQty,
              dto.minStockQty,
              dto.status,
            ),
            metadata: dto.metadata as Prisma.InputJsonValue,
          },
          include: inventoryInclude,
        });

        if (availableQty > 0) {
          await tx.stockMovement.create({
            data: {
              inventoryId: created.id,
              type: StockMovementType.INBOUND,
              quantity: availableQty,
              unit: created.unit,
              notes: 'Initial stock on create',
            },
          });
        }

        return created;
      });

      await this.audit.log({
        action: 'INVENTORY_CREATED',
        actorUserId: userId,
        organizationId: ctx.organizationId,
        entityType: EntityOwnerType.SELLER,
        entityId: inventory.id,
        newData: { availableQty, productId: dto.productId },
      });

      return inventory;
    } catch (error) {
      handlePrismaUnique(
        error,
        'Inventory already exists for this product and warehouse',
      );
    }
  }

  async findAll(userId: string, query: InventoryQueryDto) {
    const ctx = await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where = this.buildListWhere(ctx, query);

    const sortField =
      query.sortBy === 'availableQty' ||
      query.sortBy === 'updatedAt' ||
      query.sortBy === 'createdAt'
        ? query.sortBy
        : 'updatedAt';
    const sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';

    const [total, items] = await this.prisma.$transaction([
      this.prisma.inventory.count({ where }),
      this.prisma.inventory.findMany({
        where,
        include: inventoryInclude,
        orderBy: { [sortField]: sortOrder },
        skip,
        take,
      }),
    ]);

    return {
      items: items.map((row) => this.serializeInventoryRow(row)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    const row = await this.assertOwned(ctx, id);
    return this.serializeInventoryRow(row);
  }

  async update(userId: string, id: string, dto: UpdateInventoryDto) {
    const ctx = await this.ctx(userId);
    const existing = await this.assertOwned(ctx, id);

    if (dto.availableQty != null && dto.availableQty < 0) {
      throw new BadRequestException('availableQty cannot be negative');
    }

    if (dto.productId && dto.productId !== existing.productId) {
      throw new BadRequestException('productId cannot be changed');
    }
    if (dto.warehouseId && dto.warehouseId !== existing.warehouseId) {
      throw new BadRequestException('warehouseId cannot be changed via patch');
    }

    const nextAvailable =
      dto.availableQty != null
        ? dto.availableQty
        : Number(existing.availableQty);
    const nextMin =
      dto.minStockQty !== undefined
        ? dto.minStockQty
        : existing.minStockQty != null
          ? Number(existing.minStockQty)
          : null;

    const updated = await this.prisma.inventory.update({
      where: { id },
      data: {
        availableQty: dto.availableQty,
        minStockQty: dto.minStockQty,
        maxStockQty: dto.maxStockQty,
        unit: dto.unit,
        status: this.deriveStatus(nextAvailable, nextMin, dto.status),
        metadata:
          dto.metadata === undefined
            ? undefined
            : (dto.metadata as Prisma.InputJsonValue),
      },
      include: inventoryInclude,
    });

    await this.audit.log({
      action: 'INVENTORY_UPDATED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      previousData: { availableQty: existing.availableQty },
      newData: { availableQty: updated.availableQty },
    });

    return updated;
  }

  async adjust(userId: string, id: string, dto: AdjustInventoryDto) {
    const ctx = await this.ctx(userId);
    await this.assertOwned(ctx, id);

    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.inventory.findFirst({
        where: { id, organizationId: ctx.organizationId, deletedAt: null },
      });
      if (!current) throw new NotFoundException('Inventory not found');

      const currentQty = Number(current.availableQty);
      const nextQty = currentQty + dto.quantityDelta;
      if (nextQty < 0) {
        throw new BadRequestException(
          'availableQty cannot go negative after adjustment',
        );
      }

      const minStock =
        current.minStockQty != null ? Number(current.minStockQty) : null;

      const updated = await tx.inventory.update({
        where: { id },
        data: {
          availableQty: nextQty,
          status: this.deriveStatus(nextQty, minStock),
        },
        include: inventoryInclude,
      });

      // Keep marketplace offer quantity in sync so customers see live stock.
      await tx.offer.updateMany({
        where: {
          OR: [
            { inventoryId: id },
            { productId: current.productId, inventoryId: null },
            { productId: current.productId },
          ],
          organizationId: ctx.organizationId,
          deletedAt: null,
        },
        data: {
          quantity: nextQty,
          inventoryId: id,
        },
      });

      const movement = await tx.stockMovement.create({
        data: {
          inventoryId: id,
          type: dto.type,
          quantity: Math.abs(dto.quantityDelta),
          unit: current.unit,
          notes: dto.notes,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          metadata: {
            ...dto.metadata,
            quantityDelta: dto.quantityDelta,
            previousAvailableQty: currentQty,
            nextAvailableQty: nextQty,
          } as Prisma.InputJsonValue,
        },
      });

      return { inventory: updated, movement };
    });

    await this.audit.log({
      action: 'INVENTORY_ADJUSTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      newData: {
        quantityDelta: dto.quantityDelta,
        type: dto.type,
        availableQty: result.inventory.availableQty,
      },
    });

    return result;
  }

  async reserve(userId: string, id: string, dto: ReserveInventoryDto) {
    const ctx = await this.ctx(userId);
    await this.assertOwned(ctx, id);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM inventory WHERE id = ${id}::uuid FOR UPDATE
      `;
      const current = await tx.inventory.findFirst({
        where: { id, organizationId: ctx.organizationId, deletedAt: null },
      });
      if (!current) throw new NotFoundException('Inventory not found');

      const qty = new Prisma.Decimal(dto.quantity);
      const available = new Prisma.Decimal(current.availableQty);
      if (available.lessThan(qty)) {
        throw new BadRequestException(
          `Cannot reserve ${qty.toFixed(3)}; available is ${available.toFixed(3)}`,
        );
      }
      const nextAvailable = available.minus(qty);
      const nextReserved = new Prisma.Decimal(current.reservedQty).plus(qty);
      if (nextAvailable.lessThan(0) || nextReserved.lessThan(0)) {
        throw new BadRequestException('availableQty cannot be negative');
      }

      const minStock =
        current.minStockQty != null ? Number(current.minStockQty) : null;
      const updated = await tx.inventory.update({
        where: { id },
        data: {
          availableQty: nextAvailable,
          reservedQty: nextReserved,
          status: this.deriveStatus(Number(nextAvailable), minStock),
        },
        include: inventoryInclude,
      });
      await tx.stockMovement.create({
        data: {
          inventoryId: id,
          type: StockMovementType.RESERVE,
          quantity: qty,
          unit: current.unit,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          notes: 'Inventory reserved',
        },
      });
      return updated;
    });

    await this.audit.log({
      action: 'INVENTORY_RESERVED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      newData: { quantity: dto.quantity, availableQty: result.availableQty },
    });
    return result;
  }

  async release(userId: string, id: string, dto: ReserveInventoryDto) {
    const ctx = await this.ctx(userId);
    await this.assertOwned(ctx, id);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM inventory WHERE id = ${id}::uuid FOR UPDATE
      `;
      const current = await tx.inventory.findFirst({
        where: { id, organizationId: ctx.organizationId, deletedAt: null },
      });
      if (!current) throw new NotFoundException('Inventory not found');

      const qty = new Prisma.Decimal(dto.quantity);
      const reserved = new Prisma.Decimal(current.reservedQty);
      if (reserved.lessThan(qty)) {
        throw new BadRequestException(
          `Cannot release ${qty.toFixed(3)}; reserved is ${reserved.toFixed(3)}`,
        );
      }
      const nextReserved = reserved.minus(qty);
      const nextAvailable = new Prisma.Decimal(current.availableQty).plus(qty);

      const minStock =
        current.minStockQty != null ? Number(current.minStockQty) : null;
      const updated = await tx.inventory.update({
        where: { id },
        data: {
          availableQty: nextAvailable,
          reservedQty: nextReserved,
          status: this.deriveStatus(Number(nextAvailable), minStock),
        },
        include: inventoryInclude,
      });
      await tx.stockMovement.create({
        data: {
          inventoryId: id,
          type: StockMovementType.RELEASE,
          quantity: qty,
          unit: current.unit,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
          notes: 'Inventory reservation released',
        },
      });
      return updated;
    });

    await this.audit.log({
      action: 'INVENTORY_RELEASED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.SELLER,
      entityId: id,
      newData: { quantity: dto.quantity, availableQty: result.availableQty },
    });
    return result;
  }

  async lowStock(userId: string, query: InventoryQueryDto) {
    const ctx = await this.ctx(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);

    // Prisma cannot express availableQty <= minStockQty directly; filter in memory.
    const candidates = await this.prisma.inventory.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        minStockQty: { not: null },
      },
      include: inventoryInclude,
      orderBy: { updatedAt: 'desc' },
    });

    const low = candidates.filter((row) => {
      const min = row.minStockQty != null ? Number(row.minStockQty) : null;
      if (min == null) return false;
      return Number(row.availableQty) <= min;
    });

    const total = low.length;
    const items = low
      .slice(skip, skip + take)
      .map((row) => this.serializeInventoryRow(row));

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async summary(userId: string) {
    const ctx = await this.ctx(userId);
    const [rows, activeProducts, warehouseGroups] = await Promise.all([
      this.prisma.inventory.findMany({
        where: { organizationId: ctx.organizationId, deletedAt: null },
        select: {
          availableQty: true,
          reservedQty: true,
          allocatedQty: true,
          damagedQty: true,
          incomingQty: true,
          soldQty: true,
          minStockQty: true,
          status: true,
          unit: true,
          warehouseId: true,
        },
      }),
      this.prisma.product.count({
        where: {
          organizationId: ctx.organizationId,
          deletedAt: null,
          status: ProductStatus.ACTIVE,
        },
      }),
      this.prisma.inventory.groupBy({
        by: ['warehouseId'],
        where: { organizationId: ctx.organizationId, deletedAt: null },
      }),
    ]);

    let totalAvailable = 0;
    let totalReserved = 0;
    let totalAllocated = 0;
    let totalDamaged = 0;
    let totalIncoming = 0;
    let totalSold = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    let unit = 'MT';

    for (const row of rows) {
      totalAvailable += Number(row.availableQty);
      totalReserved += Number(row.reservedQty);
      totalAllocated += Number(row.allocatedQty);
      totalDamaged += Number(row.damagedQty);
      totalIncoming += Number(row.incomingQty);
      totalSold += Number(row.soldQty);
      if (row.unit) unit = row.unit;
      const min = row.minStockQty != null ? Number(row.minStockQty) : null;
      if (Number(row.availableQty) <= 0) outOfStockCount += 1;
      else if (min != null && Number(row.availableQty) <= min)
        lowStockCount += 1;
    }

    const onHandQty = totalAvailable + totalReserved;

    return {
      // Structured fields for Seller Inventory dashboard
      onHand: { quantity: onHandQty, unit },
      sellable: { quantity: totalAvailable, unit },
      activeProducts,
      lowStock: lowStockCount,
      outOfStock: outOfStockCount,
      warehouses: warehouseGroups.length,
      skuCount: rows.length,
      // Legacy aggregate fields (kept for existing clients)
      totalAvailable,
      totalReserved,
      totalAllocated,
      totalDamaged,
      totalIncoming,
      totalSold,
      lowStockCount,
      outOfStockCount,
      unit,
    };
  }

  async latestMovements(userId: string, limit = 1) {
    const ctx = await this.ctx(userId);
    const safeLimit = Math.min(20, Math.max(1, limit));

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        inventory: {
          organizationId: ctx.organizationId,
          deletedAt: null,
        },
      },
      include: {
        inventory: {
          select: {
            id: true,
            unit: true,
            product: { select: { id: true, name: true, code: true } },
            warehouse: { select: { id: true, name: true, city: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: safeLimit,
    });

    return movements.map((movement) => {
      const meta =
        movement.metadata &&
        typeof movement.metadata === 'object' &&
        !Array.isArray(movement.metadata)
          ? (movement.metadata as Record<string, unknown>)
          : {};
      const signedDelta =
        typeof meta.quantityDelta === 'number'
          ? meta.quantityDelta
          : this.signedQuantityForType(
              movement.type,
              Number(movement.quantity),
            );

      return {
        id: movement.id,
        inventoryId: movement.inventoryId,
        productId: movement.inventory.product.id,
        productName: movement.inventory.product.name,
        productCode: movement.inventory.product.code,
        warehouseId: movement.inventory.warehouse?.id ?? null,
        warehouseName: movement.inventory.warehouse?.name ?? null,
        warehouseCity: movement.inventory.warehouse?.city ?? null,
        type: movement.type,
        quantity: Number(movement.quantity),
        quantityDelta: signedDelta,
        unit: movement.unit || movement.inventory.unit || 'MT',
        notes: movement.notes,
        referenceType: movement.referenceType,
        referenceId: movement.referenceId,
        timestamp: movement.createdAt,
      };
    });
  }

  async listWarehouses(userId: string) {
    const ctx = await this.ctx(userId);
    const rows = await this.prisma.inventory.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: {
        availableQty: true,
        reservedQty: true,
        warehouse: {
          select: {
            id: true,
            code: true,
            name: true,
            city: true,
            state: true,
            isActive: true,
            status: true,
          },
        },
      },
    });

    const groups = new Map<
      string,
      {
        id: string;
        code: string;
        name: string;
        city: string | null;
        state: string | null;
        isActive: boolean;
        status: string;
        onHand: number;
        sellable: number;
        grades: number;
      }
    >();

    for (const row of rows) {
      const warehouse = row.warehouse;
      if (!warehouse) continue;
      const current = groups.get(warehouse.id) ?? {
        id: warehouse.id,
        code: warehouse.code,
        name: warehouse.name,
        city: warehouse.city,
        state: warehouse.state,
        isActive: warehouse.isActive,
        status: warehouse.status,
        onHand: 0,
        sellable: 0,
        grades: 0,
      };
      const available = Number(row.availableQty);
      const reserved = Number(row.reservedQty);
      current.onHand += available + reserved;
      current.sellable += available;
      current.grades += 1;
      groups.set(warehouse.id, current);
    }

    return Array.from(groups.values()).sort((a, b) => b.onHand - a.onHand);
  }

  private signedQuantityForType(
    type: StockMovementType,
    quantity: number,
  ): number {
    switch (type) {
      case StockMovementType.OUTBOUND:
      case StockMovementType.DISPATCH:
      case StockMovementType.DAMAGE:
      case StockMovementType.RESERVE:
        return -Math.abs(quantity);
      case StockMovementType.INBOUND:
      case StockMovementType.RECEIPT:
      case StockMovementType.RETURN:
      case StockMovementType.RELEASE:
        return Math.abs(quantity);
      default:
        return quantity;
    }
  }
}
