# Domain Model

## Identity

```text
User
 ├── OrganizationMember → Organization
 ├── UserRole → Role → Permission
 ├── CustomerProfile
 ├── SellerProfile
 └── AdminProfile
```

- One user table for all platform actors
- Roles/permissions are centralized RBAC
- Customer/Seller business attributes live on profiles linked to both `User` and `Organization`

## Organization

Organization holds legal/tax identity (GSTIN, PAN, CIN, status) and owns:

- Addresses
- Bank accounts
- Documents
- Products / inventory / offers (seller)
- Purchase requests / orders / payments / shipments (as customer or seller)

## Catalog

```text
GradeCategory → Grade → Product → Inventory → Offer
```

- **Grade** is the blind-marketplace catalog unit (no seller identity)
- **Product** is seller-owned SKU referencing a Grade
- **Offer** commercializes product/inventory with price, MOQ, validity, payment terms

## Commerce spine

```text
Customer → PurchaseRequest → ProcurementCase → SupplierQuotation
        → PurchaseOrder → Order → Payment
                        → Shipment → VehicleSlot → Tracking
                        → Settlement
```

## Supporting domains

- **Documents** — polymorphic owner (`ownerType` + `ownerId`) + R2 storage metadata
- **Notifications** — user/org targeted, multi-channel ready
- **AuditLog** — actor, entity, before/after JSON snapshots

## JSONB usage (intentional)

| Field | Why JSON |
| --- | --- |
| `Grade.applications` | Flexible application tags |
| `Product.technicalSpecs` | Variable polymer attributes |
| `Offer.paymentTerms` | Multi-term commercial matrix |
| `Order.*AddressSnapshot` | Immutable checkout snapshot |
| `Payment.gatewayMetadata` | Future gateway payloads |
| `AuditLog.previousData/newData` | Diff snapshots |
| `Notification.metadata` | Deep-link / template data |

Core FKs remain relational.
