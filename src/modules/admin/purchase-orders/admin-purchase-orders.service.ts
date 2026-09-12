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
export class AdminPurchaseOrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminListQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.PurchaseOrderWhereInput = { deletedAt: null };
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
      this.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          customerOrg: { select: orgSelect },
          sellerOrg: { select: orgSelect },
          purchaseRequest: {
            select: { id: true, referenceNumber: true, status: true },
          },
          _count: {
            select: {
              payments: true,
              dispatches: true,
              proformaInvoices: true,
            },
          },
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      items: rows.map((po) => ({
        ...po,
        subtotal: po.subtotal.toString(),
        taxAmount: po.taxAmount.toString(),
        totalAmount: po.totalAmount.toString(),
        orderedQuantity: po.orderedQuantity?.toString() ?? null,
        dispatchedQuantity: po.dispatchedQuantity.toString(),
        deliveredQuantity: po.deliveredQuantity.toString(),
      })),
      meta: paginationMeta(page, limit, total),
    };
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        customerOrg: { select: orgSelect },
        sellerOrg: { select: orgSelect },
        purchaseRequest: {
          select: { id: true, referenceNumber: true, status: true },
        },
        proformaInvoices: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            piNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            referenceNumber: true,
            status: true,
            amount: true,
            verifiedAt: true,
            createdAt: true,
          },
        },
        dispatches: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            dispatchNumber: true,
            status: true,
            actualDispatchDate: true,
            createdAt: true,
          },
        },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');

    return {
      ...po,
      subtotal: po.subtotal.toString(),
      taxAmount: po.taxAmount.toString(),
      totalAmount: po.totalAmount.toString(),
      orderedQuantity: po.orderedQuantity?.toString() ?? null,
      dispatchedQuantity: po.dispatchedQuantity.toString(),
      deliveredQuantity: po.deliveredQuantity.toString(),
      proformaInvoices: po.proformaInvoices.map((pi) => ({
        ...pi,
        totalAmount: pi.totalAmount.toString(),
      })),
      payments: po.payments.map((p) => ({
        ...p,
        amount: p.amount.toString(),
      })),
    };
  }

  async timeline(id: string) {
    const po = await this.findOne(id);
    const events: Array<{
      at: string;
      type: string;
      label: string;
      meta?: Record<string, unknown>;
    }> = [
      {
        at: po.createdAt.toISOString(),
        type: 'PO_CREATED',
        label: `Purchase order ${po.referenceNumber} created`,
        meta: { status: po.status },
      },
    ];

    if (po.confirmedAt) {
      events.push({
        at: po.confirmedAt.toISOString(),
        type: 'PO_CONFIRMED',
        label: 'Purchase order confirmed',
      });
    }

    for (const pi of po.proformaInvoices) {
      events.push({
        at: pi.createdAt.toISOString(),
        type: 'PROFORMA',
        label: `Proforma ${pi.piNumber}`,
        meta: { status: pi.status },
      });
    }

    for (const payment of po.payments) {
      events.push({
        at: (payment.verifiedAt ?? payment.createdAt).toISOString(),
        type: 'PAYMENT',
        label: `Payment ${payment.referenceNumber}`,
        meta: { status: payment.status, amount: payment.amount },
      });
    }

    for (const dispatch of po.dispatches) {
      events.push({
        at: (dispatch.actualDispatchDate ?? dispatch.createdAt).toISOString(),
        type: 'DISPATCH',
        label: `Dispatch ${dispatch.dispatchNumber}`,
        meta: { status: dispatch.status },
      });
    }

    events.sort((a, b) => a.at.localeCompare(b.at));
    return { purchaseOrderId: id, events };
  }
}
