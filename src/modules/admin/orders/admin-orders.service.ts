import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminListQueryDto } from '../common/admin-query.dto.js';

const orgSelect = {
  id: true,
  name: true,
  legalName: true,
  code: true,
} as const;

@Injectable()
export class AdminOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminListQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.OrderWhereInput = { deletedAt: null };
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { referenceNumber: { contains: q, mode: 'insensitive' } },
        { customerOrg: { name: { contains: q, mode: 'insensitive' } } },
        { sellerOrg: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          customerOrg: { select: orgSelect },
          sellerOrg: { select: orgSelect },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: rows.map((o) => ({
        ...o,
        subtotal: o.subtotal.toString(),
        taxAmount: o.taxAmount.toString(),
        freightAmount: o.freightAmount.toString(),
        discountAmount: o.discountAmount.toString(),
        platformFee: o.platformFee.toString(),
        totalAmount: o.totalAmount.toString(),
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      include: {
        customerOrg: { select: orgSelect },
        sellerOrg: { select: orgSelect },
        items: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return {
      ...order,
      subtotal: order.subtotal.toString(),
      taxAmount: order.taxAmount.toString(),
      freightAmount: order.freightAmount.toString(),
      discountAmount: order.discountAmount.toString(),
      platformFee: order.platformFee.toString(),
      totalAmount: order.totalAmount.toString(),
      items: order.items.map((item) => ({
        ...item,
        quantity: item.quantity.toString(),
        unitPrice: item.unitPrice.toString(),
        lineTotal: item.lineTotal.toString(),
      })),
    };
  }

  async timeline(id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, referenceNumber: true },
    });
    if (!order) throw new NotFoundException('Order not found');

    const history = await this.prisma.orderStatusHistory.findMany({
      where: { orderId: id },
      orderBy: { createdAt: 'asc' },
    });

    return {
      orderId: id,
      referenceNumber: order.referenceNumber,
      events: history.map((h) => ({
        id: h.id,
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        notes: h.notes,
        at: h.createdAt,
      })),
    };
  }
}
