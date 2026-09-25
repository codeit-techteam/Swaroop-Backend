import { DispatchStatus } from '../../../generated/prisma/client.js';
import {
  SELLER_DISPATCH_TAB_STATUSES,
  statusesForSellerDispatchTab,
} from './dispatch-tab.util.js';

describe('dispatch-tab.util', () => {
  it('maps ready tab to awaiting-vehicle statuses', () => {
    expect(statusesForSellerDispatchTab('ready')).toEqual(
      SELLER_DISPATCH_TAB_STATUSES.ready,
    );
    expect(statusesForSellerDispatchTab('ready')).toContain(
      DispatchStatus.AWAITING_VEHICLE,
    );
  });

  it('maps scheduled / loading / dispatched tabs', () => {
    expect(statusesForSellerDispatchTab('scheduled')).toEqual([
      DispatchStatus.VEHICLE_ASSIGNED,
      DispatchStatus.AWAITING_EWAY_BILL,
      DispatchStatus.READY_FOR_DISPATCH,
    ]);
    expect(statusesForSellerDispatchTab('loading')).toEqual([
      DispatchStatus.LOADING,
      DispatchStatus.LOADED,
    ]);
    expect(statusesForSellerDispatchTab('dispatched')).toEqual([
      DispatchStatus.DISPATCHED,
    ]);
  });

  it('returns undefined for all / empty', () => {
    expect(statusesForSellerDispatchTab('all')).toBeUndefined();
    expect(statusesForSellerDispatchTab(undefined)).toBeUndefined();
    expect(statusesForSellerDispatchTab(null)).toBeUndefined();
  });
});
