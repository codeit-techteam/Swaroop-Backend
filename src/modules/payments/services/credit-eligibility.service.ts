import { Injectable } from '@nestjs/common';
import {
  CreditAccountStatus,
  CreditStatus,
  PaymentMethod,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { FinanceException } from '../common/finance.errors.js';
import { isPlatformCredit } from '../common/platform-credit.js';
import { cmp, toDecimal } from '../common/money.util.js';

type TxClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class CreditEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  requiresCreditCheck(method: PaymentMethod | null | undefined): boolean {
    return isPlatformCredit(method);
  }

  async inspect(
    tx: TxClient,
    customerOrgId: string,
    poTotal: Prisma.Decimal | number | string = 0,
  ): Promise<{
    eligible: boolean;
    reason: string | null;
    creditAccountId: string | null;
    availableLimit: string;
    approvedLimit: string;
    status: CreditStatus | null;
    accountStatus: CreditAccountStatus | null;
    tenureOptions: Array<{
      paymentOption: PaymentMethod;
      tenureDays: number;
      label: string;
    }>;
  }> {
    const empty = {
      eligible: false,
      reason: 'CREDIT_NOT_ELIGIBLE' as string | null,
      creditAccountId: null as string | null,
      availableLimit: '0.00',
      approvedLimit: '0.00',
      status: null as CreditStatus | null,
      accountStatus: null as CreditAccountStatus | null,
      tenureOptions: [] as Array<{
        paymentOption: PaymentMethod;
        tenureDays: number;
        label: string;
      }>,
    };

    const profile = await tx.customerProfile.findFirst({
      where: { organizationId: customerOrgId, deletedAt: null },
      include: { creditProfile: true },
    });
    const credit = profile?.creditProfile;
    if (!credit) {
      return { ...empty, reason: 'CREDIT_NOT_ELIGIBLE' };
    }

    empty.creditAccountId = credit.id;
    empty.availableLimit = toDecimal(credit.availableLimit).toFixed(2);
    empty.approvedLimit = toDecimal(credit.approvedLimit).toFixed(2);
    empty.status = credit.status;
    empty.accountStatus = credit.accountStatus;

    if (credit.status !== CreditStatus.APPROVED) {
      return { ...empty, reason: 'CREDIT_NOT_ELIGIBLE' };
    }
    if (credit.accountStatus !== CreditAccountStatus.ACTIVE) {
      return { ...empty, reason: 'CREDIT_NOT_ELIGIBLE' };
    }
    if (credit.expiresAt && credit.expiresAt.getTime() < Date.now()) {
      return { ...empty, reason: 'CREDIT_NOT_ELIGIBLE' };
    }

    const available = toDecimal(credit.availableLimit);
    const total = toDecimal(poTotal);
    if (cmp(available, total) < 0) {
      return { ...empty, eligible: false, reason: 'CREDIT_LIMIT_EXCEEDED' };
    }

    return {
      eligible: true,
      reason: null,
      creditAccountId: credit.id,
      availableLimit: available.toFixed(2),
      approvedLimit: toDecimal(credit.approvedLimit).toFixed(2),
      status: credit.status,
      accountStatus: credit.accountStatus,
      tenureOptions: [
        {
          paymentOption: PaymentMethod.CREDIT_15,
          tenureDays: 15,
          label: 'PetroTrade Credit — 15 Days',
        },
        {
          paymentOption: PaymentMethod.CREDIT_30,
          tenureDays: 30,
          label: 'PetroTrade Credit — 30 Days',
        },
      ],
    };
  }

  /**
   * Validates customer org credit for platform CREDIT / CREDIT_15 / CREDIT_30.
   * Missing, unapproved, expired, or insufficient accounts fail.
   */
  async assertEligible(
    tx: TxClient,
    customerOrgId: string,
    poTotal: Prisma.Decimal | number | string,
  ): Promise<{
    creditAccountId: string;
    availableLimit: string;
    approvedLimit: string;
    status: CreditStatus;
    accountStatus: CreditAccountStatus;
  }> {
    const profile = await tx.customerProfile.findFirst({
      where: { organizationId: customerOrgId, deletedAt: null },
      include: { creditProfile: true },
    });

    const credit = profile?.creditProfile;
    if (!credit) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        'No PetroTrade credit account found for customer organization',
      );
    }

    if (credit.status !== CreditStatus.APPROVED) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        `Credit status is ${credit.status}; must be APPROVED`,
      );
    }
    if (credit.accountStatus !== CreditAccountStatus.ACTIVE) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        `Credit account is ${credit.accountStatus}`,
      );
    }
    if (credit.expiresAt && credit.expiresAt.getTime() < Date.now()) {
      throw new FinanceException(
        'CREDIT_NOT_AVAILABLE',
        'Credit account has expired',
      );
    }

    const available = toDecimal(credit.availableLimit);
    const total = toDecimal(poTotal);
    if (cmp(available, total) < 0) {
      throw new FinanceException(
        'CREDIT_LIMIT_EXCEEDED',
        `Available credit ${available.toFixed(2)} is less than requested ${total.toFixed(2)}`,
      );
    }

    return {
      creditAccountId: credit.id,
      availableLimit: available.toFixed(2),
      approvedLimit: toDecimal(credit.approvedLimit).toFixed(2),
      status: credit.status,
      accountStatus: credit.accountStatus,
    };
  }
}
