# Phase 9 — Logistics, Dispatch, Shipment & Delivery APIs

Dispatch planning, vehicle/driver masters, e-way bill (manual), shipment tracking, delivery + POD metadata, and payment milestone hooks from Phase 8.

Base path: `/api/v1`

## Flow

```
PO (CONFIRMED) + payment clearance
  → Dispatch (AWAITING_VEHICLE)
  → Assign vehicle (AWAITING_EWAY_BILL)
  → E-way bill (READY_FOR_DISPATCH)
  → Start/complete loading (optional)
  → Execute dispatch → Shipment (DISPATCHED) + Delivery (SCHEDULED)
  → Tracking IN_TRANSIT → OUT_FOR_DELIVERY
  → Seller mark-delivered → Customer confirm
```

## Payment gate

`DispatchGateService.checkForPurchaseOrder` blocks when ADVANCE / BEFORE_DISPATCH schedules still have remaining amount.

`ON_LOADING` / `ON_DELIVERY` / cleared credit do not block create-dispatch.

Milestones:

- `start-loading` → `markPaymentMilestoneDue(ON_LOADING)`
- `mark-delivered` → `markPaymentMilestoneDue(ON_DELIVERY)`

## Seller (`SELLER`)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/seller/logistics/summary` | Counts |
| GET | `/seller/dispatches/summary` | Tab KPI counts (all / ready / scheduled / loading / dispatched) |
| GET/POST | `/seller/dispatches` | List supports `tab`, `search`, `dispatchStatus`, pagination. Create: `{ purchaseOrderId, quantity, ... }` |
| GET | `/seller/dispatches/:id` | Blind buyer + vehicle/slot/warehouse/grade |
| GET | `/seller/dispatches/:id/timeline` | LogisticsEvent audit timeline |
| POST | `/seller/dispatches/:id/assign-vehicle` | `{ vehicleId, driverId? }` |
| GET/POST | `/seller/dispatches/:id/eway-bill` | Manual number + optional `documentKey` |
| POST | `/seller/dispatches/:id/start-loading` | → LOADING |
| POST | `/seller/dispatches/:id/complete-loading` | → LOADED |
| POST | `/seller/dispatches/:id/mark-ready` | → READY_FOR_DISPATCH |
| POST | `/seller/dispatches/:id/dispatch` | Creates SHP + Delivery |
| GET | `/seller/shipments` | |
| GET | `/seller/shipments/:id` | |
| GET | `/seller/shipments/:id/tracking` | |
| POST | `/seller/shipments/:id/tracking-events` | Chain: DISPATCHED→IN_TRANSIT→OUT_FOR_DELIVERY→DELIVERED |
| POST | `/seller/shipments/:id/eta` | `{ eta }` |
| GET | `/seller/deliveries` | |
| POST | `/seller/deliveries/:id/mark-delivered` | Updates PO.deliveredQuantity |
| POST | `/seller/deliveries/:id/upload-pod` | R2 key metadata only |
| CRUD | `/seller/vehicles`, `/seller/drivers` | Org-scoped |
| GET | `/seller/vehicle-slots` | Filters: status, warehouseId, date, vehicleType, carrier, orderId, search |
| GET | `/seller/vehicle-slots/summary` | Today KPI totals + available capacity |
| GET | `/seller/vehicle-slots/availability` | Bay/time window availability |
| GET | `/seller/vehicle-slots/eligible-dispatches` | Payment-cleared dispatches without active slot |
| GET | `/seller/vehicle-slots/export` | Filtered export rows |
| GET | `/seller/logistics/warehouses` | Seller + platform hub warehouses |
| GET | `/seller/logistics/loading-bays?warehouseId=` | Bay labels for a warehouse |
| POST | `/seller/vehicle-slots` | Transactional book (dispatch + vehicle + bay/time) |
| POST | `/seller/vehicle-slots/:id/cancel` | |

### Create dispatch

```json
{
  "purchaseOrderId": "uuid",
  "quantity": 40,
  "plannedDispatchDate": "2026-09-15T00:00:00.000Z",
  "originWarehouseId": "uuid?",
  "destinationRegion": "West India",
  "idempotencyKey": "optional"
}
```

Numbers: `DSP-YYYY-######` / `SHP-YYYY-######`.

`dispatchedQuantity` increments only on execute-dispatch.

## Customer (`CUSTOMER`)

| Method | Path |
| --- | --- |
| GET | `/customer/shipment-summary` |
| GET | `/customer/shipments` |
| GET | `/customer/shipments/:id` |
| GET | `/customer/shipments/:id/status` |
| GET | `/customer/shipments/:id/tracking` |
| GET | `/customer/deliveries` |
| GET | `/customer/deliveries/:id` |
| POST | `/customer/deliveries/:id/confirm` |
| POST | `/customer/deliveries/:id/upload-pod` |
| GET | `/customer/deliveries/:id/pod-url` |

Customer DTOs expose `ANONYMOUS SUPPLIER` only — no seller email/phone/company/org id.

## Admin (`ADMIN` \| `SUPER_ADMIN` \| `OPERATIONS_MANAGER`)

All under `/admin/logistics/*`: summary, dispatches, shipments, deliveries, vehicles, drivers, vehicle-slots, e-way validate/cancel, mark-exception / resolve-exception.

## Blind security

- Seller views: `ANONYMOUS BUYER` + buyer reference hash
- Customer views: `ANONYMOUS SUPPLIER` + supplier reference hash
- Admin: full operational fields

## Error codes

`PO_NOT_FOUND`, `PO_NOT_ELIGIBLE_FOR_DISPATCH`, `PAYMENT_NOT_CLEARED`, `DISPATCH_NOT_FOUND`, `DISPATCH_QUANTITY_EXCEEDED`, `INSUFFICIENT_INVENTORY`, `VEHICLE_NOT_FOUND`, `VEHICLE_ALREADY_ASSIGNED`, `VEHICLE_CAPACITY_INSUFFICIENT`, `VEHICLE_DOCUMENT_EXPIRED`, `VEHICLE_NOT_COMPLIANT`, `DRIVER_LICENSE_EXPIRED`, `EWAY_BILL_REQUIRED`, `EWAY_BILL_EXPIRED`, `SHIPMENT_ALREADY_CREATED`, `INVALID_SHIPMENT_TRANSITION`, `DELIVERY_ALREADY_CONFIRMED`, `UNAUTHORIZED_LOGISTICS_ACCESS`, …

## Limitations

- No GST portal e-way bill integration (manual entry + document key)
- POD stores R2 object key only; signed URL when StorageService is configured
- Invoice lifecycle hooks are no-op (no auto tax-invoice issue)
- Inventory check is soft: fails only when an inventory row exists and available qty is short
- Tracking `DELIVERED` does not confirm delivery; seller `mark-delivered` + customer `confirm` do
