import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import { FinanceException } from '../common/finance.errors.js';
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

    const result = await this.schedules.isPaymentClearedForDispatch(poId);
    return {
      purchaseOrderId: poId,
      referenceNumber: po.referenceNumber,
      ...result,
    };
  }
}
