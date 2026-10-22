import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CurrencyCode,
  GradeStatus,
  Prisma,
  ProductStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { toDecimal } from '../../payments/common/money.util.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import type {
  CreatePriceAlertDto,
  ListPriceAlertsQueryDto,
  UpdatePriceAlertDto,
} from './price-alerts.dto.js';

/**
 * Price alert CRUD. Trigger evaluation is intentionally not simulated —
 * there is no authoritative continuous price feed worker yet. Clients must
 * not claim real-time alerting until `PriceAlertEvaluationWorker` is wired
 * to real offer/grade price updates.
 */
@Injectable()
export class PriceAlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerContext: CustomerContextService,
  ) {}

  private map(row: {
    id: string;
    gradeId: string;
    productId: string | null;
    targetPrice: Prisma.Decimal;
    currency: CurrencyCode;
    unit: string;
    direction: string;
    enabled: boolean;
    lastTriggeredAt: Date | null;
    lastTriggeredPrice: Prisma.Decimal | null;
    createdAt: Date;
    updatedAt: Date;
    grade?: { id: string; code: string; name: string; displayName: string | null };
    product?: { id: string; code: string; name: string } | null;
  }) {
    return {
      id: row.id,
      gradeId: row.gradeId,
      productId: row.productId,
      targetPrice: row.targetPrice.toFixed(4),
      currency: row.currency,
      unit: row.unit,
      direction: row.direction,
      enabled: row.enabled,
      lastTriggeredAt: row.lastTriggeredAt,
      lastTriggeredPrice: row.lastTriggeredPrice?.toFixed(4) ?? null,
      evaluation: {
        supported: false,
        reason:
          'No authoritative price-feed worker is configured. Alerts are stored but will not fire until evaluation infrastructure is enabled.',
      },
      grade: row.grade
        ? {
            id: row.grade.id,
            code: row.grade.code,
            name: row.grade.displayName ?? row.grade.name,
          }
        : undefined,
      product: row.product
        ? {
            id: row.product.id,
            code: row.product.code,
            name: row.product.name,
          }
        : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async list(userId: string, query: ListPriceAlertsQueryDto) {
    const customer = await this.customerContext.getOrCreateCustomer(userId);
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.PriceAlertWhereInput = {
      customerProfileId: customer.customerProfileId,
      deletedAt: null,
      ...(query.gradeId ? { gradeId: query.gradeId } : {}),
      ...(query.enabled !== undefined
        ? { enabled: query.enabled === 'true' }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.priceAlert.count({ where }),
      this.prisma.priceAlert.findMany({
        where,
        include: {
          grade: {
            select: { id: true, code: true, name: true, displayName: true },
          },
          product: { select: { id: true, code: true, name: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
    ]);
    return {
      items: rows.map((r) => this.map(r)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async create(userId: string, dto: CreatePriceAlertDto) {
    const customer = await this.customerContext.getOrCreateCustomer(userId);
    const grade = await this.prisma.grade.findFirst({
      where: {
        id: dto.gradeId,
        deletedAt: null,
        status: GradeStatus.ACTIVE,
        customerVisible: true,
      },
      select: { id: true },
    });
    if (!grade) throw new NotFoundException('Grade not found');

    if (dto.productId) {
      const product = await this.prisma.product.findFirst({
        where: {
          id: dto.productId,
          gradeId: dto.gradeId,
          deletedAt: null,
          status: ProductStatus.ACTIVE,
        },
        select: { id: true },
      });
      if (!product) {
        throw new BadRequestException(
          'Product not found for this grade or is not active',
        );
      }
    }

    const target = toDecimal(dto.targetPrice);
    if (target.lte(0)) {
      throw new BadRequestException('targetPrice must be greater than 0');
    }

    const duplicate = await this.prisma.priceAlert.findFirst({
      where: {
        customerProfileId: customer.customerProfileId,
        gradeId: dto.gradeId,
        productId: dto.productId ?? null,
        direction: dto.direction ?? 'BELOW',
        unit: dto.unit ?? 'MT',
        currency: dto.currency ?? CurrencyCode.INR,
        targetPrice: target,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException(
        'An identical price alert already exists for this grade',
      );
    }

    const created = await this.prisma.priceAlert.create({
      data: {
        customerProfileId: customer.customerProfileId,
        userId,
        gradeId: dto.gradeId,
        productId: dto.productId ?? null,
        targetPrice: target,
        currency: dto.currency ?? CurrencyCode.INR,
        unit: dto.unit ?? 'MT',
        direction: dto.direction ?? 'BELOW',
        enabled: dto.enabled ?? true,
      },
      include: {
        grade: {
          select: { id: true, code: true, name: true, displayName: true },
        },
        product: { select: { id: true, code: true, name: true } },
      },
    });
    return this.map(created);
  }

  async update(userId: string, id: string, dto: UpdatePriceAlertDto) {
    const customer = await this.customerContext.getOrCreateCustomer(userId);
    const existing = await this.prisma.priceAlert.findFirst({
      where: { id, customerProfileId: customer.customerProfileId, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Price alert not found');

    const data: Prisma.PriceAlertUpdateInput = {};
    if (dto.targetPrice !== undefined) {
      const target = toDecimal(dto.targetPrice);
      if (target.lte(0)) {
        throw new BadRequestException('targetPrice must be greater than 0');
      }
      data.targetPrice = target;
    }
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.direction !== undefined) data.direction = dto.direction;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;

    const updated = await this.prisma.priceAlert.update({
      where: { id },
      data,
      include: {
        grade: {
          select: { id: true, code: true, name: true, displayName: true },
        },
        product: { select: { id: true, code: true, name: true } },
      },
    });
    return this.map(updated);
  }

  async remove(userId: string, id: string) {
    const customer = await this.customerContext.getOrCreateCustomer(userId);
    const existing = await this.prisma.priceAlert.findFirst({
      where: { id, customerProfileId: customer.customerProfileId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Price alert not found');
    await this.prisma.priceAlert.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false },
    });
    return { id, deleted: true };
  }
}
