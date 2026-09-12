import { Injectable } from '@nestjs/common';
import {
  CounterOfferStatus,
  CurrencyCode,
  NegotiationActorRole,
  PaymentMethod,
  type CounterOffer,
  type Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { ProcurementException } from './procurement.errors.js';

type TxClient = Prisma.TransactionClient;

export type CreateCounterParams = {
  purchaseRequestId: string;
  createdByRole: NegotiationActorRole;
  createdByUserId?: string | null;
  sellerProfileId?: string | null;
  unitPrice: number | Prisma.Decimal;
  quantity: number | Prisma.Decimal;
  paymentMethod?: PaymentMethod | null;
  currency?: CurrencyCode;
  validUntil?: Date | null;
  note?: string | null;
  supersedePrevious?: boolean;
};

@Injectable()
export class NegotiationService {
  constructor(private readonly prisma: PrismaService) {}

  async list(purchaseRequestId: string) {
    return this.prisma.counterOffer.findMany({
      where: { purchaseRequestId },
      orderBy: [{ roundNumber: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getLatestPending(purchaseRequestId: string) {
    return this.prisma.counterOffer.findFirst({
      where: {
        purchaseRequestId,
        status: CounterOfferStatus.PENDING,
      },
      orderBy: [{ roundNumber: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createCounter(tx: TxClient, params: CreateCounterParams) {
    const previous = await tx.counterOffer.findFirst({
      where: {
        purchaseRequestId: params.purchaseRequestId,
        status: CounterOfferStatus.PENDING,
      },
      orderBy: [{ roundNumber: 'desc' }, { createdAt: 'desc' }],
    });

    const maxRound = await tx.counterOffer.aggregate({
      where: { purchaseRequestId: params.purchaseRequestId },
      _max: { roundNumber: true },
    });
    const roundNumber = (maxRound._max.roundNumber ?? 0) + 1;

    if (params.supersedePrevious !== false && previous) {
      await tx.counterOffer.update({
        where: { id: previous.id },
        data: { status: CounterOfferStatus.SUPERSEDED },
      });
    }

    return tx.counterOffer.create({
      data: {
        purchaseRequestId: params.purchaseRequestId,
        createdByRole: params.createdByRole,
        createdByUserId: params.createdByUserId ?? undefined,
        sellerProfileId: params.sellerProfileId ?? undefined,
        roundNumber,
        unitPrice: params.unitPrice,
        quantity: params.quantity,
        paymentMethod: params.paymentMethod ?? undefined,
        currency: params.currency ?? CurrencyCode.INR,
        validUntil: params.validUntil ?? undefined,
        note: params.note ?? undefined,
        status: CounterOfferStatus.PENDING,
        previousCounterOfferId: previous?.id,
      },
    });
  }

  async acceptLatest(tx: TxClient, purchaseRequestId: string) {
    const latest = await tx.counterOffer.findFirst({
      where: {
        purchaseRequestId,
        status: CounterOfferStatus.PENDING,
      },
      orderBy: [{ roundNumber: 'desc' }, { createdAt: 'desc' }],
    });
    if (!latest) {
      throw new ProcurementException(
        'COUNTER_OFFER_NOT_FOUND',
        'No pending counter-offer to accept',
      );
    }
    await this.expireIfNeeded(tx, latest);
    return tx.counterOffer.update({
      where: { id: latest.id },
      data: {
        status: CounterOfferStatus.ACCEPTED,
        respondedAt: new Date(),
      },
    });
  }

  async rejectLatest(tx: TxClient, purchaseRequestId: string) {
    const latest = await tx.counterOffer.findFirst({
      where: {
        purchaseRequestId,
        status: CounterOfferStatus.PENDING,
      },
      orderBy: [{ roundNumber: 'desc' }, { createdAt: 'desc' }],
    });
    if (!latest) {
      throw new ProcurementException(
        'COUNTER_OFFER_NOT_FOUND',
        'No pending counter-offer to reject',
      );
    }
    return tx.counterOffer.update({
      where: { id: latest.id },
      data: {
        status: CounterOfferStatus.REJECTED,
        respondedAt: new Date(),
      },
    });
  }

  async expireIfNeeded(tx: TxClient, counter: CounterOffer) {
    if (
      counter.status === CounterOfferStatus.PENDING &&
      counter.validUntil &&
      counter.validUntil < new Date()
    ) {
      await tx.counterOffer.update({
        where: { id: counter.id },
        data: { status: CounterOfferStatus.EXPIRED },
      });
      throw new ProcurementException(
        'COUNTER_OFFER_EXPIRED',
        'Counter-offer validity window has expired',
      );
    }
  }

  toBlindNegotiation(rounds: CounterOffer[]) {
    return rounds.map((r) => ({
      roundNumber: r.roundNumber,
      role: r.createdByRole,
      unitPrice: r.unitPrice,
      quantity: r.quantity,
      paymentMethod: r.paymentMethod,
      currency: r.currency,
      status: r.status,
      validUntil: r.validUntil,
      note: r.note,
      createdAt: r.createdAt,
      respondedAt: r.respondedAt,
    }));
  }

  toAdminNegotiation(rounds: CounterOffer[]) {
    return rounds.map((r) => ({
      id: r.id,
      roundNumber: r.roundNumber,
      role: r.createdByRole,
      createdByUserId: r.createdByUserId,
      sellerProfileId: r.sellerProfileId,
      unitPrice: r.unitPrice,
      quantity: r.quantity,
      paymentMethod: r.paymentMethod,
      currency: r.currency,
      status: r.status,
      validUntil: r.validUntil,
      note: r.note,
      previousCounterOfferId: r.previousCounterOfferId,
      createdAt: r.createdAt,
      respondedAt: r.respondedAt,
    }));
  }
}
