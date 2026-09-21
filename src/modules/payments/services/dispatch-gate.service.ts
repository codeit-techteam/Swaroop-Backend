import { Injectable } from '@nestjs/common';
import {
  CreditAccountStatus,
  CreditStatus,
  CreditTransactionStatus,
  CreditTransactionType,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { FinanceException } from '../common/finance.errors.js';
import { isPlatformCredit } from '../common/platform-credit.js';
import { PaymentScheduleService } from './payment-schedule.service.js';

@Injectable()
export class DispatchGateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedules: PaymentScheduleService,
  ) {}

  async checkForPurchaseOrder(
    poId: string,
    opts?: { customerOrgId?: string; sellerOrgId?: string },
  ) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where: {
        id: poId,
        deletedAt: null,
        ...(opts?.customerOrgId ? { customerOrgId: opts.customerOrgId } : {}),
        ...(opts?.sellerOrgId ? { sellerOrgId: opts.sellerOrgId } : {}),
      },
    });
    if (!po) {
      throw new FinanceException('PURCHASE_ORDER_NOT_FOUND');
    }

    if (isPlatformCredit(po.paymentMethod)) {
      const credit = await this.prisma.customerProfile.findFirst({
        where: { organizationId: po.customerOrgId, deletedAt: null },
        include: { creditProfile: true },
      });
      const account = credit?.creditProfile;
      const reserved = await this.prisma.creditTransaction.findFirst({
        where: {
          purchaseOrderId: po.id,
          type: {
            in: [
              CreditTransactionType.CREDIT_RESERVED,
              CreditTransactionType.CREDIT_UTILIZED,
            ],
          },
          status: CreditTransactionStatus.POSTED,
        },
        select: { id: true, type: true },
      });
      const released = await this.prisma.creditTransaction.findFirst({
        where: {
          purchaseOrderId: po.id,
          type: CreditTransactionType.CREDIT_RELEASED,
          status: CreditTransactionStatus.POSTED,
        },
        select: { id: true },
      });

      const accountOk =
        account?.status === CreditStatus.APPROVED &&
        account.accountStatus === CreditAccountStatus.ACTIVE &&
        (!account.expiresAt || account.expiresAt.getTime() >= Date.now());

      const cleared = Boolean(accountOk && reserved && !released);
      return {
        purchaseOrderId: poId,
        referenceNumber: po.referenceNumber,
        paymentMethod: po.paymentMethod,
        platformCreditStatus: cleared
          ? 'PLATFORM_CREDIT_APPROVED'
          : accountOk
            ? 'PLATFORM_CREDIT_PENDING'
            : 'PLATFORM_CREDIT_BLOCKED',
        creditSource: 'PETROTRADE / SWAROOP CREDIT MANAGEMENT',
        cleared,
        blockingSchedules: cleared
          ? []
          : [
              {
                id: po.id,
                type: 'CREDIT' as const,
                remainingAmount: '0.00',
                status: cleared ? 'CLEARED' : 'CREDIT_NOT_CLEARED',
              },
            ],
      };
    }

    const result = await this.schedules.isPaymentClearedForDispatch(poId);
    return {
      purchaseOrderId: poId,
      referenceNumber: po.referenceNumber,
      paymentMethod: po.paymentMethod,
      ...result,
    };
  }
}
