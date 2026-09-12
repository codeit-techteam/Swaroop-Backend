import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { round2, sub, toDecimal } from '../common/money.util.js';

export type SettlementCalcInput = {
  grossAmount: Prisma.Decimal | number | string;
  taxAmount?: Prisma.Decimal | number | string;
  platformFee?: Prisma.Decimal | number | string;
  tdsAmount?: Prisma.Decimal | number | string;
  /** Explicit deductions; defaults to 0 unless config provides otherwise. */
  deductions?: Prisma.Decimal | number | string;
};

export type SettlementCalcResult = {
  grossAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  platformFee: Prisma.Decimal;
  tdsAmount: Prisma.Decimal;
  deductions: Prisma.Decimal;
  netAmount: Prisma.Decimal;
};

@Injectable()
export class SettlementCalculationService {
  calculate(input: SettlementCalcInput): SettlementCalcResult {
    const grossAmount = round2(input.grossAmount);
    const taxAmount = round2(input.taxAmount ?? 0);
    const platformFee = round2(input.platformFee ?? 0);
    const tdsAmount = round2(input.tdsAmount ?? 0);
    const deductions = round2(input.deductions ?? 0);

    const netAmount = round2(
      sub(
        sub(
          sub(toDecimal(grossAmount).plus(taxAmount), platformFee),
          tdsAmount,
        ),
        deductions,
      ),
    );

    return {
      grossAmount,
      taxAmount,
      platformFee,
      tdsAmount,
      deductions,
      netAmount,
    };
  }
}
