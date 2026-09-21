import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CreditApplicationStatus,
  CreditStatus,
  EntityOwnerType,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { RoleCode } from '../../../common/enums/domain.enums.js';
import { generateUniqueCreditRef } from '../../payments/common/credit-number.js';
import { toDecimal } from '../../payments/common/money.util.js';
import { utilizationPercentage } from '../../payments/services/credit-ledger.service.js';
import { NotificationService } from '../../notifications/notification.service.js';
import { CustomerAuditService } from '../common/customer-audit.service.js';
import { CustomerContextService } from '../common/customer-context.service.js';
import { CreditEligibilityService } from '../../payments/services/credit-eligibility.service.js';
import type { CustomerCreditApplyDto } from './customer-credit.dto.js';

const OPEN: CreditApplicationStatus[] = [
  CreditApplicationStatus.PENDING,
  CreditApplicationStatus.UNDER_REVIEW,
  CreditApplicationStatus.DOCUMENTS_REQUIRED,
];

@Injectable()
export class CustomerCreditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly context: CustomerContextService,
    private readonly audit: CustomerAuditService,
    private readonly notifications: NotificationService,
    private readonly creditEligibility: CreditEligibilityService,
  ) {}

  async getAccount(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const [account, application] = await Promise.all([
      this.prisma.customerCreditProfile.findUnique({
        where: { customerProfileId: ctx.customerProfileId },
      }),
      this.prisma.creditApplication.findFirst({
        where: { customerProfileId: ctx.customerProfileId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      customerId: ctx.customerProfileId,
      application: application
        ? {
            id: application.id,
            applicationNumber: application.applicationNumber,
            status: application.status,
            requestedLimit: toDecimal(application.requestedLimit).toFixed(2),
            requestedTenureDays: application.requestedTenureDays,
            purpose: application.purpose,
            createdAt: application.createdAt,
            updatedAt: application.updatedAt,
          }
        : null,
      account: account ? this.mapAccount(account) : null,
    };
  }

  async getStatus(userId: string) {
    const snapshot = await this.getAccount(userId);
    return {
      customerId: snapshot.customerId,
      applicationStatus: snapshot.application?.status ?? 'NOT_APPLIED',
      accountStatus: snapshot.account?.accountStatus ?? null,
      creditStatus: snapshot.account?.status ?? CreditStatus.NOT_APPLIED,
      displayStatus: this.displayStatus(snapshot),
    };
  }

  async getLimit(userId: string) {
    const snapshot = await this.getAccount(userId);
    return {
      customerId: snapshot.customerId,
      status: this.displayStatus(snapshot),
      approvedLimit: snapshot.account?.approvedLimit ?? '0.00',
      availableLimit: snapshot.account?.availableLimit ?? '0.00',
      pendingCredit: snapshot.account?.pendingCredit ?? '0.00',
      utilizedAmount: snapshot.account?.utilizedAmount ?? '0.00',
      outstandingAmount: snapshot.account?.outstandingAmount ?? '0.00',
      currency: snapshot.account?.currency ?? 'INR',
    };
  }

  async getSummary(userId: string) {
    const snapshot = await this.getAccount(userId);
    return {
      ...snapshot,
      status: this.displayStatus(snapshot),
    };
  }

  async getEligibility(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const inspected = await this.creditEligibility.inspect(
      this.prisma,
      ctx.organizationId,
      0,
    );
    return {
      eligible: inspected.eligible,
      approvedLimit: inspected.approvedLimit,
      availableLimit: inspected.availableLimit,
      tenureOptions: inspected.tenureOptions,
      source: 'PETROTRADE',
    };
  }

  async listTransactions(userId: string) {
    const ctx = await this.context.requireCustomer(userId);
    const rows = await this.prisma.creditTransaction.findMany({
      where: { customerProfileId: ctx.customerProfileId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      transactionNumber: row.transactionNumber,
      type: row.type,
      status: row.status,
      amount: toDecimal(row.amount).toFixed(2),
      balanceBefore:
        row.balanceBefore != null
          ? toDecimal(row.balanceBefore).toFixed(2)
          : null,
      balanceAfter:
        row.balanceAfter != null
          ? toDecimal(row.balanceAfter).toFixed(2)
          : null,
      purchaseOrderId: row.purchaseOrderId,
      paymentId: row.paymentId,
      notes: row.notes,
      createdAt: row.createdAt,
    }));
  }

  async apply(userId: string, dto: CustomerCreditApplyDto) {
    const ctx = await this.context.requireCustomer(userId);
    const open = await this.prisma.creditApplication.findFirst({
      where: {
        customerProfileId: ctx.customerProfileId,
        status: { in: OPEN },
      },
    });
    if (open) {
      throw new BadRequestException(
        `An open credit application already exists (${open.applicationNumber})`,
      );
    }

    const requestedLimit = toDecimal(dto.requestedLimit);
    const applicationNumber = await generateUniqueCreditRef(
      async (candidate) =>
        Boolean(
          await this.prisma.creditApplication.findUnique({
            where: { applicationNumber: candidate },
            select: { id: true },
          }),
        ),
      'CRA',
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const application = await tx.creditApplication.create({
        data: {
          applicationNumber,
          customerProfileId: ctx.customerProfileId,
          status: CreditApplicationStatus.PENDING,
          requestedLimit,
          requestedTenureDays: dto.requestedTenureDays,
          purpose: dto.purpose,
        },
      });
      await tx.customerProfile.update({
        where: { id: ctx.customerProfileId },
        data: { creditStatus: CreditStatus.PENDING },
      });
      await tx.customerCreditProfile.upsert({
        where: { customerProfileId: ctx.customerProfileId },
        update: {
          status: CreditStatus.PENDING,
          requestedLimit,
        },
        create: {
          customerProfileId: ctx.customerProfileId,
          status: CreditStatus.PENDING,
          requestedLimit,
        },
      });
      return application;
    });

    await this.audit.log({
      action: 'CREDIT_APPLICATION_SUBMITTED',
      actorUserId: userId,
      organizationId: ctx.organizationId,
      entityType: EntityOwnerType.CREDIT,
      entityId: created.id,
      newData: {
        applicationNumber: created.applicationNumber,
        requestedLimit: requestedLimit.toFixed(2),
      },
    });

    const adminRoles = await this.prisma.userRole.findMany({
      where: {
        role: {
          code: {
            in: [
              RoleCode.ADMIN,
              RoleCode.SUPER_ADMIN,
              RoleCode.FINANCE_MANAGER,
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
          title: 'New credit application',
          body: `${ctx.organizationName} requested credit of ${requestedLimit.toFixed(2)}`,
          entityType: EntityOwnerType.CREDIT,
          entityId: created.id,
        }),
      ),
    );

    return {
      id: created.id,
      applicationNumber: created.applicationNumber,
      status: created.status,
      requestedLimit: requestedLimit.toFixed(2),
      requestedTenureDays: created.requestedTenureDays,
      purpose: created.purpose,
      createdAt: created.createdAt,
    };
  }

  private mapAccount(account: {
    id: string;
    accountNumber: string | null;
    status: CreditStatus;
    accountStatus: string;
    approvedLimit: Prisma.Decimal | number | string | null;
    availableLimit: Prisma.Decimal | number | string | null;
    pendingCredit?: Prisma.Decimal | number | string | null;
    utilizedAmount: Prisma.Decimal | number | string | null;
    outstandingAmount: Prisma.Decimal | number | string | null;
    overdueAmount: Prisma.Decimal | number | string | null;
    currency: string;
    creditTermDays: number | null;
    approvedAt: Date | null;
    expiresAt: Date | null;
  }) {
    return {
      id: account.id,
      accountNumber: account.accountNumber,
      status: account.status,
      accountStatus: account.accountStatus,
      approvedLimit: toDecimal(account.approvedLimit).toFixed(2),
      availableLimit: toDecimal(account.availableLimit).toFixed(2),
      pendingCredit: toDecimal(account.pendingCredit).toFixed(2),
      utilizedAmount: toDecimal(account.utilizedAmount).toFixed(2),
      outstandingAmount: toDecimal(account.outstandingAmount).toFixed(2),
      overdueAmount: toDecimal(account.overdueAmount).toFixed(2),
      utilizationPercentage: utilizationPercentage(
        account.utilizedAmount,
        account.approvedLimit,
      ),
      currency: account.currency,
      creditTermDays: account.creditTermDays,
      approvedAt: account.approvedAt,
      expiresAt: account.expiresAt,
    };
  }

  private displayStatus(snapshot: {
    application?: { status: string } | null;
    account?: {
      status: string;
      accountStatus: string;
    } | null;
  }) {
    if (!snapshot.account && !snapshot.application) return 'NOT_APPLIED';
    if (snapshot.account?.accountStatus === 'SUSPENDED') return 'SUSPENDED';
    if (snapshot.account?.accountStatus === 'BLOCKED') return 'BLOCKED';
    if (snapshot.account?.accountStatus === 'EXPIRED') return 'EXPIRED';
    if (snapshot.account?.status === CreditStatus.APPROVED) return 'ACTIVE';
    return (
      snapshot.application?.status ?? snapshot.account?.status ?? 'PENDING'
    );
  }
}
