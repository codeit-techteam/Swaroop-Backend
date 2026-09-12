import { Injectable } from '@nestjs/common';
import {
  NegotiationActorRole,
  PurchaseRequestStatus,
  type PurchaseRequest,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { ProcurementException } from './procurement.errors.js';

const TERMINAL_STATUSES = new Set<PurchaseRequestStatus>([
  PurchaseRequestStatus.REJECTED,
  PurchaseRequestStatus.EXPIRED,
  PurchaseRequestStatus.CANCELLED,
  PurchaseRequestStatus.CONVERTED_TO_ORDER,
  PurchaseRequestStatus.WITHDRAWN,
]);

const PENDING_FOR_EXPIRY = new Set<PurchaseRequestStatus>([
  PurchaseRequestStatus.SOURCING,
  PurchaseRequestStatus.SUBMITTED,
  PurchaseRequestStatus.UNDER_REVIEW,
  PurchaseRequestStatus.NEGOTIATION,
  PurchaseRequestStatus.OFFER_RECEIVED,
  PurchaseRequestStatus.PENDING_APPROVAL,
]);

/** Allowed commercial transitions for Phase 7. */
const ALLOWED: Partial<Record<PurchaseRequestStatus, PurchaseRequestStatus[]>> =
  {
    [PurchaseRequestStatus.SOURCING]: [
      PurchaseRequestStatus.APPROVED,
      PurchaseRequestStatus.REJECTED,
      PurchaseRequestStatus.NEGOTIATION,
      PurchaseRequestStatus.EXPIRED,
      PurchaseRequestStatus.CANCELLED,
      PurchaseRequestStatus.OFFER_RECEIVED,
      PurchaseRequestStatus.CONVERTED_TO_ORDER,
    ],
    [PurchaseRequestStatus.NEGOTIATION]: [
      PurchaseRequestStatus.APPROVED,
      PurchaseRequestStatus.REJECTED,
      PurchaseRequestStatus.NEGOTIATION,
      PurchaseRequestStatus.EXPIRED,
      PurchaseRequestStatus.CANCELLED,
      PurchaseRequestStatus.CONVERTED_TO_ORDER,
    ],
    [PurchaseRequestStatus.APPROVED]: [
      PurchaseRequestStatus.CONVERTED_TO_ORDER,
    ],
    [PurchaseRequestStatus.OFFER_RECEIVED]: [
      PurchaseRequestStatus.APPROVED,
      PurchaseRequestStatus.REJECTED,
      PurchaseRequestStatus.NEGOTIATION,
      PurchaseRequestStatus.EXPIRED,
      PurchaseRequestStatus.CANCELLED,
      PurchaseRequestStatus.CONVERTED_TO_ORDER,
      PurchaseRequestStatus.OFFER_RECEIVED,
    ],
    [PurchaseRequestStatus.SUBMITTED]: [
      PurchaseRequestStatus.SOURCING,
      PurchaseRequestStatus.UNDER_REVIEW,
      PurchaseRequestStatus.APPROVED,
      PurchaseRequestStatus.REJECTED,
      PurchaseRequestStatus.NEGOTIATION,
      PurchaseRequestStatus.EXPIRED,
      PurchaseRequestStatus.CANCELLED,
      PurchaseRequestStatus.OFFER_RECEIVED,
      PurchaseRequestStatus.CONVERTED_TO_ORDER,
    ],
    [PurchaseRequestStatus.UNDER_REVIEW]: [
      PurchaseRequestStatus.SOURCING,
      PurchaseRequestStatus.APPROVED,
      PurchaseRequestStatus.REJECTED,
      PurchaseRequestStatus.NEGOTIATION,
      PurchaseRequestStatus.EXPIRED,
      PurchaseRequestStatus.CANCELLED,
      PurchaseRequestStatus.OFFER_RECEIVED,
      PurchaseRequestStatus.CONVERTED_TO_ORDER,
    ],
  };

@Injectable()
export class PrStateService {
  constructor(private readonly prisma: PrismaService) {}

  isTerminal(status: PurchaseRequestStatus): boolean {
    return TERMINAL_STATUSES.has(status);
  }

  assertTransition(
    from: PurchaseRequestStatus,
    to: PurchaseRequestStatus,
  ): void {
    if (from === to && to === PurchaseRequestStatus.NEGOTIATION) {
      return;
    }
    const allowed = ALLOWED[from];
    if (!allowed?.includes(to)) {
      throw new ProcurementException(
        'INVALID_STATUS_TRANSITION',
        `Cannot transition purchase request from ${from} to ${to}`,
      );
    }
  }

  isSellerActionable(
    status: PurchaseRequestStatus,
    latestCounterRole?: NegotiationActorRole | null,
  ): boolean {
    if (this.isTerminal(status)) return false;
    if (status === PurchaseRequestStatus.SOURCING) return true;
    if (status === PurchaseRequestStatus.OFFER_RECEIVED) return true;
    if (status === PurchaseRequestStatus.SUBMITTED) return true;
    if (status === PurchaseRequestStatus.UNDER_REVIEW) return true;
    if (status === PurchaseRequestStatus.NEGOTIATION) {
      return (
        latestCounterRole === NegotiationActorRole.CUSTOMER ||
        latestCounterRole == null
      );
    }
    return false;
  }

  isCustomerCounterActionable(
    status: PurchaseRequestStatus,
    latestCounterRole?: NegotiationActorRole | null,
  ): boolean {
    if (status !== PurchaseRequestStatus.NEGOTIATION) return false;
    return latestCounterRole === NegotiationActorRole.SELLER;
  }

  remainingSeconds(deadline: Date | null | undefined): number | null {
    if (!deadline) return null;
    return Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000));
  }

  deadlineOf(pr: {
    responseDeadline?: Date | null;
    expiresAt?: Date | null;
  }): Date | null {
    return pr.responseDeadline ?? pr.expiresAt ?? null;
  }

  isPastDeadline(pr: {
    responseDeadline?: Date | null;
    expiresAt?: Date | null;
  }): boolean {
    const deadline = this.deadlineOf(pr);
    return Boolean(deadline && deadline < new Date());
  }

  /**
   * If deadline passed and PR is still pending, mark EXPIRED and throw 409.
   */
  async assertNotExpired(
    pr: Pick<
      PurchaseRequest,
      'id' | 'status' | 'responseDeadline' | 'expiresAt'
    >,
  ): Promise<void> {
    if (!this.isPastDeadline(pr)) return;
    if (PENDING_FOR_EXPIRY.has(pr.status)) {
      await this.prisma.purchaseRequest.update({
        where: { id: pr.id },
        data: { status: PurchaseRequestStatus.EXPIRED },
      });
    }
    throw new ProcurementException(
      'PURCHASE_REQUEST_EXPIRED',
      'Purchase request response window has expired',
    );
  }

  sellerAllowedActions(
    status: PurchaseRequestStatus,
    latestCounterRole?: NegotiationActorRole | null,
  ): string[] {
    if (this.isTerminal(status)) return [];
    if (!this.isSellerActionable(status, latestCounterRole)) {
      return status === PurchaseRequestStatus.NEGOTIATION ? ['VIEW'] : [];
    }
    const actions = ['ACCEPT', 'REJECT', 'COUNTER'];
    if (
      status === PurchaseRequestStatus.SOURCING ||
      status === PurchaseRequestStatus.OFFER_RECEIVED ||
      status === PurchaseRequestStatus.SUBMITTED ||
      status === PurchaseRequestStatus.UNDER_REVIEW
    ) {
      actions.push('RESPOND');
    }
    return actions;
  }

  customerAllowedActions(
    status: PurchaseRequestStatus,
    latestCounterRole?: NegotiationActorRole | null,
  ): string[] {
    if (this.isTerminal(status)) {
      return status === PurchaseRequestStatus.CONVERTED_TO_ORDER
        ? ['VIEW']
        : [];
    }
    const actions: string[] = ['VIEW', 'CANCEL'];
    if (this.isCustomerCounterActionable(status, latestCounterRole)) {
      actions.push('ACCEPT_COUNTER', 'REJECT_COUNTER', 'COUNTER');
    } else if (status === PurchaseRequestStatus.NEGOTIATION) {
      actions.push('COUNTER');
    }
    return actions;
  }
}
