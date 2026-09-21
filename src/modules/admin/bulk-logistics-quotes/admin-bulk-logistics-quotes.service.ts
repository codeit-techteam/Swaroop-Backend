import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BulkLogisticsQuoteStatus,
  EntityOwnerType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  paginationMeta,
  resolveSearch,
  skipTake,
} from '../../master-data/common/pagination.js';
import { toDecimal } from '../../payments/common/money.util.js';
import { AdminAuditService } from '../common/admin-audit.service.js';
import type {
  AdminBulkLogisticsQuoteNotesDto,
  AdminBulkLogisticsQuotesQueryDto,
} from './admin-bulk-logistics-quotes.dto.js';

const CUSTOMER_SELECT = {
  id: true,
  userId: true,
  organizationId: true,
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
  organization: {
    select: {
      id: true,
      name: true,
      legalName: true,
      code: true,
      businessType: true,
      gstin: true,
      pan: true,
      email: true,
      phone: true,
    },
  },
} as const;

const ADMIN_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  displayName: true,
} as const;

@Injectable()
export class AdminBulkLogisticsQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminBulkLogisticsQuotesQueryDto) {
    const { page, limit, skip, take } = skipTake(query.page, query.limit);
    const where: Prisma.BulkLogisticsQuoteRequestWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.customerId) where.customerProfileId = query.customerId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const search = resolveSearch(query);
    if (search) {
      where.OR = [
        { requestNumber: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { materialName: { contains: search, mode: 'insensitive' } },
        { deliveryLocation: { contains: search, mode: 'insensitive' } },
        { pickupLocation: { contains: search, mode: 'insensitive' } },
        {
          customerProfile: {
            organization: { name: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.bulkLogisticsQuoteRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          customerProfile: { select: CUSTOMER_SELECT },
          assignedAdmin: { select: ADMIN_SELECT },
        },
      }),
      this.prisma.bulkLogisticsQuoteRequest.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.mapRow(row)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getById(id: string) {
    const row = await this.requireRow(id);
    return this.mapRow(row);
  }

  async startReview(id: string, actorUserId: string) {
    const existing = await this.requireRow(id);
    if (
      existing.status !== BulkLogisticsQuoteStatus.SUBMITTED &&
      existing.status !== BulkLogisticsQuoteStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(
        `Cannot start review from status ${existing.status}`,
      );
    }

    const updated = await this.prisma.bulkLogisticsQuoteRequest.update({
      where: { id },
      data: {
        status: BulkLogisticsQuoteStatus.UNDER_REVIEW,
        assignedAdminId: actorUserId,
        reviewedAt: existing.reviewedAt ?? new Date(),
      },
      include: {
        customerProfile: { select: CUSTOMER_SELECT },
        assignedAdmin: { select: ADMIN_SELECT },
      },
    });

    await this.audit.log({
      action: 'BULK_LOGISTICS_QUOTE_REVIEW_STARTED',
      actorUserId,
      organizationId: existing.customerProfile.organizationId,
      entityType: EntityOwnerType.OTHER,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status: BulkLogisticsQuoteStatus.UNDER_REVIEW },
    });

    return this.mapRow(updated);
  }

  async markQuoted(
    id: string,
    actorUserId: string,
    dto: AdminBulkLogisticsQuoteNotesDto,
  ) {
    const existing = await this.requireRow(id);
    if (
      existing.status === BulkLogisticsQuoteStatus.CLOSED ||
      existing.status === BulkLogisticsQuoteStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot mark quoted from status ${existing.status}`,
      );
    }

    const updated = await this.prisma.bulkLogisticsQuoteRequest.update({
      where: { id },
      data: {
        status: BulkLogisticsQuoteStatus.QUOTED,
        assignedAdminId: existing.assignedAdminId ?? actorUserId,
        adminNotes: dto.notes?.trim() || existing.adminNotes,
        reviewedAt: existing.reviewedAt ?? new Date(),
      },
      include: {
        customerProfile: { select: CUSTOMER_SELECT },
        assignedAdmin: { select: ADMIN_SELECT },
      },
    });

    await this.audit.log({
      action: 'BULK_LOGISTICS_QUOTE_MARKED_QUOTED',
      actorUserId,
      organizationId: existing.customerProfile.organizationId,
      entityType: EntityOwnerType.OTHER,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status: BulkLogisticsQuoteStatus.QUOTED, notes: dto.notes },
    });

    return this.mapRow(updated);
  }

  async close(
    id: string,
    actorUserId: string,
    dto: AdminBulkLogisticsQuoteNotesDto,
  ) {
    const existing = await this.requireRow(id);
    if (existing.status === BulkLogisticsQuoteStatus.CANCELLED) {
      throw new BadRequestException('Request is already cancelled');
    }

    const updated = await this.prisma.bulkLogisticsQuoteRequest.update({
      where: { id },
      data: {
        status: BulkLogisticsQuoteStatus.CLOSED,
        assignedAdminId: existing.assignedAdminId ?? actorUserId,
        adminNotes: dto.notes?.trim() || existing.adminNotes,
        closedAt: new Date(),
      },
      include: {
        customerProfile: { select: CUSTOMER_SELECT },
        assignedAdmin: { select: ADMIN_SELECT },
      },
    });

    await this.audit.log({
      action: 'BULK_LOGISTICS_QUOTE_CLOSED',
      actorUserId,
      organizationId: existing.customerProfile.organizationId,
      entityType: EntityOwnerType.OTHER,
      entityId: id,
      previousData: { status: existing.status },
      newData: { status: BulkLogisticsQuoteStatus.CLOSED, notes: dto.notes },
    });

    return this.mapRow(updated);
  }

  private async requireRow(id: string) {
    const row = await this.prisma.bulkLogisticsQuoteRequest.findUnique({
      where: { id },
      include: {
        customerProfile: { select: CUSTOMER_SELECT },
        assignedAdmin: { select: ADMIN_SELECT },
      },
    });
    if (!row) throw new NotFoundException('Bulk logistics quote not found');
    return row;
  }

  private mapRow(row: {
    id: string;
    requestNumber: string;
    status: BulkLogisticsQuoteStatus;
    contactName: string;
    companyName: string;
    email: string;
    phone: string;
    materialName: string;
    quantityMt: Prisma.Decimal | number | string;
    pickupLocation: string;
    deliveryLocation: string;
    preferredDate: Date | null;
    message: string | null;
    adminNotes: string | null;
    assignedAdminId: string | null;
    reviewedAt: Date | null;
    closedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    customerProfile: {
      id: string;
      userId: string;
      organizationId: string;
      user: {
        id: string;
        email: string | null;
        phone: string | null;
        firstName: string | null;
        lastName: string | null;
        displayName: string | null;
      };
      organization: {
        id: string;
        name: string;
        legalName: string | null;
        code: string | null;
        businessType: string | null;
        gstin: string | null;
        pan: string | null;
        email: string | null;
        phone: string | null;
      };
    };
    assignedAdmin: {
      id: string;
      email: string | null;
      phone: string | null;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
    } | null;
  }) {
    const org = row.customerProfile.organization;
    const user = row.customerProfile.user;
    const admin = row.assignedAdmin;

    return {
      id: row.id,
      requestNumber: row.requestNumber,
      status: row.status,
      contactName: row.contactName,
      companyName: row.companyName,
      email: row.email,
      phone: row.phone,
      materialName: row.materialName,
      quantityMt: toDecimal(row.quantityMt).toFixed(3),
      pickupLocation: row.pickupLocation,
      deliveryLocation: row.deliveryLocation,
      preferredDate: row.preferredDate
        ? row.preferredDate.toISOString().slice(0, 10)
        : null,
      message: row.message,
      adminNotes: row.adminNotes,
      reviewedAt: row.reviewedAt,
      closedAt: row.closedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      assignedAdminId: row.assignedAdminId,
      assignedAdminName:
        admin?.displayName ||
        [admin?.firstName, admin?.lastName].filter(Boolean).join(' ') ||
        admin?.email ||
        null,
      customer: {
        id: row.customerProfile.id,
        userId: row.customerProfile.userId,
        name: org.legalName || org.name,
        businessType: org.businessType,
        contactName:
          user.displayName ||
          [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          null,
        email: org.email || user.email,
        phone: org.phone || user.phone,
        gstin: org.gstin,
        pan: org.pan,
        organizationId: org.id,
        organizationCode: org.code,
      },
    };
  }
}
