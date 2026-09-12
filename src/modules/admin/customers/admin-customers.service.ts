import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerStatus,
  EntityOwnerType,
  Prisma,
  UserStatus,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  skipTake,
} from '../../master-data/common/pagination.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
  AdminCustomerActionDto,
  AdminCustomersQueryDto,
} from './admin-customers.dto.js';

const customerInclude = {
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      status: true,
    },
  },
  organization: {
    select: {
      id: true,
      name: true,
      legalName: true,
      code: true,
      status: true,
      verificationStatus: true,
      gstin: true,
      pan: true,
    },
  },
  creditProfile: true,
  _count: {
    select: {
      purchaseRequests: true,
      orders: true,
    },
  },
} satisfies Prisma.CustomerProfileInclude;

@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminCustomersQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.CustomerProfileWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { organization: { name: { contains: q, mode: 'insensitive' } } },
        { organization: { legalName: { contains: q, mode: 'insensitive' } } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
        { user: { phone: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.customerProfile.findMany({
        where,
        include: customerInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.customerProfile.count({ where }),
    ]);

    return { items, meta: paginationMeta(page, limit, total) };
  }

  async findOne(id: string) {
    const customer = await this.prisma.customerProfile.findFirst({
      where: { id, deletedAt: null },
      include: customerInclude,
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async suspend(id: string, actorUserId: string, dto: AdminCustomerActionDto) {
    const customer = await this.findOne(id);
    if (customer.status === CustomerStatus.SUSPENDED) {
      throw new BadRequestException('Customer already suspended');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customerProfile.update({
        where: { id },
        data: {
          status: CustomerStatus.SUSPENDED,
          notes: dto.reason ?? dto.notes ?? customer.notes,
        },
      });
      await tx.user.update({
        where: { id: customer.userId },
        data: { status: UserStatus.SUSPENDED },
      });
    });

    await this.audit.log({
      action: 'CUSTOMER_SUSPENDED',
      actorUserId,
      organizationId: customer.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: id,
      previousData: { status: customer.status },
      newData: { status: CustomerStatus.SUSPENDED, reason: dto.reason },
    });

    return this.findOne(id);
  }

  async activate(id: string, actorUserId: string, dto: AdminCustomerActionDto) {
    const customer = await this.findOne(id);

    await this.prisma.$transaction(async (tx) => {
      await tx.customerProfile.update({
        where: { id },
        data: {
          status: CustomerStatus.ACTIVE,
          notes: dto.notes ?? customer.notes,
        },
      });
      await tx.user.update({
        where: { id: customer.userId },
        data: { status: UserStatus.ACTIVE },
      });
    });

    await this.audit.log({
      action: 'CUSTOMER_ACTIVATED',
      actorUserId,
      organizationId: customer.organizationId,
      entityType: EntityOwnerType.CUSTOMER,
      entityId: id,
      previousData: { status: customer.status },
      newData: { status: CustomerStatus.ACTIVE },
    });

    return this.findOne(id);
  }
}
