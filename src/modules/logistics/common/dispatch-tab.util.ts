import { DispatchStatus } from '../../../generated/prisma/client.js';

/** UI tabs on Seller Dispatch screen → backend status sets */
export type SellerDispatchTab =
  | 'ready'
  | 'scheduled'
  | 'loading'
  | 'dispatched';

export const SELLER_DISPATCH_TAB_STATUSES: Record<
  SellerDispatchTab,
  DispatchStatus[]
> = {
  /** Awaiting schedule / vehicle assignment */
  ready: [
    DispatchStatus.DRAFT,
    DispatchStatus.PLANNED,
    DispatchStatus.AWAITING_VEHICLE,
  ],
  /** Vehicle / e-way / ready-to-load path */
  scheduled: [
    DispatchStatus.VEHICLE_ASSIGNED,
    DispatchStatus.AWAITING_EWAY_BILL,
    DispatchStatus.READY_FOR_DISPATCH,
  ],
  loading: [DispatchStatus.LOADING, DispatchStatus.LOADED],
  dispatched: [DispatchStatus.DISPATCHED],
};

export function statusesForSellerDispatchTab(
  tab?: string | null,
): DispatchStatus[] | undefined {
  if (!tab || tab === 'all') return undefined;
  return SELLER_DISPATCH_TAB_STATUSES[tab as SellerDispatchTab];
}
