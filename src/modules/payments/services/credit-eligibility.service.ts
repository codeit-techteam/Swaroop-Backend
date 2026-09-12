import { Injectable } from '@nestjs/common';
import {
  CreditStatus,
  PaymentMethod,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { FinanceException } from '../common/finance.errors.js';
import { cmp, toDecimal } from '../common/money.util.js';

type TxClient = Prisma.TransactionClient;

@Injectable()
export class CreditEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  requiresCreditCheck(method: PaymentMethod | null | undefined): boolean {
    return (
      method === PaymentMethod.CREDIT_15 || method === PaymentMethod.CREDIT_30
    );
  }

  /**
   * Validates customer org credit for CREDIT_15 / CREDIT_30 POs.
   * Does NOT return true by default — missing/unapproved profile fails.
   */
  async assertEligible(
    tx: TxClient | PrismaService,
    customerOrgId: string,
    poTotal: Prisma.Decimal | number | string,
  ): Promise<void> {
    const profile = await tx.customerProfile.findFirst({
      where: { organizationId: customerOrgId, deletedAt: null },
      include: { creditProfile: true },
    });

    const credit = profile?.creditProfile;
    if (!credit) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        'No credit profile found for customer organization',
      );
    }

    if (credit.status !== CreditStatus.APPROVED) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        `Credit status is ${credit.status}; must be APPROVED`,
      );
    }

    const available = toDecimal(credit.availableLimit);
    const total = toDecimal(poTotal);
    if (cmp(available, total) < 0) {
      throw new FinanceException(
        'CREDIT_LIMIT_EXCEEDED',
        `Available credit ${available.toFixed(2)} is less than PO total ${total.toFixed(2)}`,
      );
    }
  }
}
