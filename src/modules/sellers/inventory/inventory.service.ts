import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EntityOwnerType,
  InventoryStatus,
  Prisma,
  StockMovementType,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
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
  UpdateInventoryDto,
} from './inventory.dto.js';

const inventoryInclude = {
  product: {
    select: { id: true, code: true, name: true, gradeId: true, unit: true },
  },
  warehouse: {
    select: { id: true, code: true, name: true, city: true, state: true },
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
    const where: Prisma.InventoryWhereInput = {
      organizationId: ctx.organizationId,
      deletedAt: null,
    };
    if (query.status) where.status = query.status;
    if (query.productId) where.productId = query.productId;
    if (query.warehouseId) where.warehouseId = query.warehouseId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { product: { name: { contains: q, mode: 'insensitive' } } },
        { product: { code: { contains: q, mode: 'insensitive' } } },
        { warehouse: { name: { contains: q, mode: 'insensitive' } } },
        { warehouse: { code: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.inventory.count({ where }),
      this.prisma.inventory.findMany({
        where,
        include: inventoryInclude,
        orderBy: {
          createdAt: query.sortOrder === 'asc' ? 'asc' : 'desc',
        },
        skip,
        take,
      }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(userId: string, id: string) {
    const ctx = await this.ctx(userId);
    return this.assertOwned(ctx, id);
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
    const items = low.slice(skip, skip + take);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async summary(userId: string) {
    const ctx = await this.ctx(userId);
    const rows = await this.prisma.inventory.findMany({
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
      },
    });

    let totalAvailable = 0;
    let totalReserved = 0;
    let totalAllocated = 0;
    let totalDamaged = 0;
    let totalIncoming = 0;
    let totalSold = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const row of rows) {
      totalAvailable += Number(row.availableQty);
      totalReserved += Number(row.reservedQty);
      totalAllocated += Number(row.allocatedQty);
      totalDamaged += Number(row.damagedQty);
      totalIncoming += Number(row.incomingQty);
      totalSold += Number(row.soldQty);
      const min = row.minStockQty != null ? Number(row.minStockQty) : null;
      if (Number(row.availableQty) <= 0) outOfStockCount += 1;
      else if (min != null && Number(row.availableQty) <= min)
        lowStockCount += 1;
    }

    return {
      skuCount: rows.length,
      totalAvailable,
      totalReserved,
      totalAllocated,
      totalDamaged,
      totalIncoming,
      totalSold,
      lowStockCount,
      outOfStockCount,
    };
  }
}
