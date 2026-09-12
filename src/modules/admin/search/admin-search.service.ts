import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';

@Injectable()
export class AdminSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string) {
    const term = q.trim();
    if (!term) {
      return {
        users: [],
        customers: [],
        sellers: [],
        grades: [],
        products: [],
        offers: [],
        purchaseRequests: [],
        purchaseOrders: [],
        payments: [],
        shipments: [],
      };
    }

    const take = 8;

    const [
      users,
      customers,
      sellers,
      grades,
      products,
      offers,
      purchaseRequests,
      purchaseOrders,
      payments,
      shipments,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          OR: [
            { email: { contains: term, mode: 'insensitive' } },
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { phone: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
        },
      }),
      this.prisma.customerProfile.findMany({
        where: {
          deletedAt: null,
          OR: [
            { organization: { name: { contains: term, mode: 'insensitive' } } },
            { user: { email: { contains: term, mode: 'insensitive' } } },
          ],
        },
        take,
        select: {
          id: true,
          status: true,
          organization: { select: { id: true, name: true } },
          user: { select: { id: true, email: true } },
        },
      }),
      this.prisma.sellerProfile.findMany({
        where: {
          deletedAt: null,
          OR: [
            { organization: { name: { contains: term, mode: 'insensitive' } } },
            { user: { email: { contains: term, mode: 'insensitive' } } },
          ],
        },
        take,
        select: {
          id: true,
          status: true,
          organization: { select: { id: true, name: true } },
          user: { select: { id: true, email: true } },
        },
      }),
      this.prisma.grade.findMany({
        where: {
          deletedAt: null,
          OR: [
            { code: { contains: term, mode: 'insensitive' } },
            { name: { contains: term, mode: 'insensitive' } },
            { displayName: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        select: { id: true, code: true, name: true, displayName: true },
      }),
      this.prisma.product.findMany({
        where: {
          deletedAt: null,
          OR: [
            { code: { contains: term, mode: 'insensitive' } },
            { name: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        select: { id: true, code: true, name: true, status: true },
      }),
      this.prisma.offer.findMany({
        where: {
          deletedAt: null,
          OR: [
            { referenceNumber: { contains: term, mode: 'insensitive' } },
            { product: { name: { contains: term, mode: 'insensitive' } } },
          ],
        },
        take,
        select: {
          id: true,
          referenceNumber: true,
          status: true,
          basePrice: true,
        },
      }),
      this.prisma.purchaseRequest.findMany({
        where: {
          deletedAt: null,
          referenceNumber: { contains: term, mode: 'insensitive' },
        },
        take,
        select: { id: true, referenceNumber: true, status: true },
      }),
      this.prisma.purchaseOrder.findMany({
        where: {
          deletedAt: null,
          referenceNumber: { contains: term, mode: 'insensitive' },
        },
        take,
        select: { id: true, referenceNumber: true, status: true },
      }),
      this.prisma.payment.findMany({
        where: {
          OR: [
            { referenceNumber: { contains: term, mode: 'insensitive' } },
            { utr: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        select: {
          id: true,
          referenceNumber: true,
          status: true,
          amount: true,
        },
      }),
      this.prisma.shipment.findMany({
        where: {
          deletedAt: null,
          OR: [
            { referenceNumber: { contains: term, mode: 'insensitive' } },
            { ewayBillNumber: { contains: term, mode: 'insensitive' } },
          ],
        },
        take,
        select: {
          id: true,
          referenceNumber: true,
          ewayBillNumber: true,
          status: true,
        },
      }),
    ]);

    return {
      users,
      customers,
      sellers,
      grades,
      products,
      offers: offers.map((o) => ({
        ...o,
        basePrice: o.basePrice.toString(),
      })),
      purchaseRequests,
      purchaseOrders,
      payments: payments.map((p) => ({
        ...p,
        amount: p.amount.toString(),
      })),
      shipments,
    };
  }
}
