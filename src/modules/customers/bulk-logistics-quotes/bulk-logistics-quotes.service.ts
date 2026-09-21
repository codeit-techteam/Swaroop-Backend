import { Injectable } from '@nestjs/common';
import {
  BulkLogisticsQuoteStatus,
  EntityOwnerType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { generateUniqueCreditRef } from '../../payments/common/credit-number.js';
import { toDecimal } from '../../payments/common/money.util.js';
import { CustomerAuditService } from '../common/customer-audit.service.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import type { CreateBulkLogisticsQuoteDto } from './bulk-logistics-quotes.dto.js';

@Injectable()
export class BulkLogisticsQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: CustomerContextService,
    private readonly audit: CustomerAuditService,
    private readonly notifications: NotificationService,
  ) {}

  async create(userId: string, dto: CreateBulkLogisticsQuoteDto) {
    const ctx = await this.context.requireCustomer(userId);
    const quantityMt = toDecimal(dto.quantityMt);
    const requestNumber = await generateUniqueCreditRef(
      async (candidate) =>
        Boolean(
          await this.prisma.bulkLogisticsQuoteRequest.findUnique({
            where: { requestNumber: candidate },
            select: { id: true },
          }),
        ),
      'BLQ',
    );

    const preferredDate = dto.preferredDate
      ? new Date(`${dto.preferredDate.slice(0, 10)}T00:00:00.000Z`)
      : null;

    const created = await this.prisma.bulkLogisticsQuoteRequest.create({
      data: {
        requestNumber,
        customerProfileId: ctx.customerProfileId,
        status: BulkLogisticsQuoteStatus.SUBMITTED,
        contactName: dto.contactName.trim(),
        companyName: dto.companyName.trim(),
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone.trim(),
        materialName: dto.materialName.trim(),
        quantityMt,
        pickupLocation: dto.pickupLocation.trim(),
        deliveryLocation: dto.deliveryLocation.trim(),
        preferredDate,
        message: dto.message?.trim() || null,
      },
    });

    await this.audit.log({
      action: 'BULK_LOGISTICS_QUOTE_SUBMITTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.OTHER,
      entityId: created.id,
      newData: {
        requestNumber: created.requestNumber,
        quantityMt: quantityMt.toFixed(3),
        pickupLocation: created.pickupLocation,
        deliveryLocation: created.deliveryLocation,
      },
    });

    const adminRoles = await this.prisma.userRole.findMany({
      where: {
        role: {
          code: {
            in: [
              RoleCode.ADMIN,
              RoleCode.SUPER_ADMIN,
              RoleCode.OPERATIONS_MANAGER,
            ],
          },
        },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    await Promise.all(
      adminRoles.map((row) =>
        this.notifications.create({
          userId: row.userId,
          title: 'New bulk logistics quote',
          body: `${created.companyName} requested ${quantityMt.toFixed(3)} MT logistics (${created.requestNumber})`,
          entityType: EntityOwnerType.OTHER,
          entityId: created.id,
        }),
      ),
    );

    return this.toFacing(created);
  }

  async listMine(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const rows = await this.prisma.bulkLogisticsQuoteRequest.findMany({
      where: { customerProfileId: ctx.customerProfileId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((row) => this.toFacing(row));
  }

  private toFacing(row: {
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
    createdAt: Date;
    updatedAt: Date;
  }) {
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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
