import { Injectable } from '@nestjs/common';
import type { PurchaseOrder } from '../../../generated/prisma/client.js';
import {
  addQty,
  cmpQty,
  round3,
  subQty,
  toQty,
} from '../common/quantity.util.js';

type CommercialSnapshot = {
  quantity?: number | string | null;
  productId?: string | null;
};

@Injectable()
export class QuantityService {
  orderedQuantity(po: PurchaseOrder): ReturnType<typeof toQty> {
    if (po.orderedQuantity != null) {
      return round3(po.orderedQuantity);
    }
    const meta = po.metadata as {
      commercialSnapshot?: CommercialSnapshot;
    } | null;
    const fromSnapshot = meta?.commercialSnapshot?.quantity;
    return round3(fromSnapshot ?? 0);
  }

  dispatchedQuantity(po: PurchaseOrder): ReturnType<typeof toQty> {
    return round3(po.dispatchedQuantity ?? 0);
  }

  deliveredQuantity(po: PurchaseOrder): ReturnType<typeof toQty> {
    return round3(po.deliveredQuantity ?? 0);
  }

  remainingToDispatch(po: PurchaseOrder): ReturnType<typeof toQty> {
    return subQty(this.orderedQuantity(po), this.dispatchedQuantity(po));
  }

  remainingToDeliver(po: PurchaseOrder): ReturnType<typeof toQty> {
    return subQty(this.dispatchedQuantity(po), this.deliveredQuantity(po));
  }

  assertDispatchQuantity(po: PurchaseOrder, quantity: number | string) {
    const qty = round3(quantity);
    if (cmpQty(qty, 0) <= 0) {
      return {
        ok: false as const,
        remaining: this.remainingToDispatch(po),
        qty,
      };
    }
    const remaining = this.remainingToDispatch(po);
    if (cmpQty(qty, remaining) > 0) {
      return { ok: false as const, remaining, qty };
    }
    return { ok: true as const, remaining, qty };
  }

  productIdFromPo(po: PurchaseOrder): string | null {
    const meta = po.metadata as {
      commercialSnapshot?: CommercialSnapshot;
    } | null;
    return meta?.commercialSnapshot?.productId ?? null;
  }

  summary(po: PurchaseOrder) {
    const ordered = this.orderedQuantity(po);
    const dispatched = this.dispatchedQuantity(po);
    const delivered = this.deliveredQuantity(po);
    return {
      orderedQuantity: ordered.toFixed(3),
      dispatchedQuantity: dispatched.toFixed(3),
      deliveredQuantity: delivered.toFixed(3),
      remainingToDispatch: subQty(ordered, dispatched).toFixed(3),
      remainingToDeliver: subQty(dispatched, delivered).toFixed(3),
    };
  }

  add(a: number | string, b: number | string) {
    return addQty(a, b);
  }
}
