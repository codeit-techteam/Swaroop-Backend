import { createHash } from 'node:crypto';
import type {
  Delivery,
  Dispatch,
  Driver,
  EWayBill,
  Shipment,
  ShipmentTrackingEvent,
  Vehicle,
  VehicleSlot,
} from '../../../generated/prisma/client.js';
import { toQty } from './quantity.util.js';

function buyerRef(customerOrgId: string): string {
  const hash = createHash('sha256').update(customerOrgId).digest('hex');
  return `BUYER-${hash.slice(0, 8).toUpperCase()}`;
}

function supplierRef(sellerOrgId: string): string {
  const hash = createHash('sha256').update(sellerOrgId).digest('hex');
  return `SUP-${hash.slice(0, 8).toUpperCase()}`;
}

function dec(v: unknown): string | null {
  if (v == null) return null;
  return toQty(v as string | number).toFixed(3);
}

type DispatchRow = Dispatch & {
  ewayBills?: EWayBill[];
  shipments?: Shipment[];
  purchaseOrder?: { referenceNumber: string; status: string } | null;
};

type ShipmentRow = Shipment & {
  trackingEvents?: ShipmentTrackingEvent[];
  delivery?: Delivery | null;
  purchaseOrder?: { referenceNumber: string; status: string } | null;
  dispatch?: { dispatchNumber: string; status: string } | null;
  items?: Array<{ id: string; quantity: unknown; unit: string }>;
};

type DeliveryRow = Delivery & {
  shipment?: {
    id: string;
    referenceNumber: string;
    status: string;
  } | null;
  purchaseOrder?: { referenceNumber: string } | null;
};

export function toCustomerShipment(s: ShipmentRow) {
  return {
    id: s.id,
    referenceNumber: s.referenceNumber,
    purchaseOrderId: s.purchaseOrderId,
    purchaseOrderReference: s.purchaseOrder?.referenceNumber ?? null,
    dispatchId: s.dispatchId,
    quantity: dec(s.quantity),
    unit: s.unit,
    status: s.status,
    dispatchedAt: s.dispatchedAt,
    deliveredAt: s.deliveredAt,
    eta: s.eta,
    destinationRegion:
      (s.destinationSnapshot as { region?: string } | null)?.region ?? null,
    supplier: {
      displayName: 'ANONYMOUS SUPPLIER',
      reference: supplierRef(s.sellerOrgId),
    },
    trackingEvents: (s.trackingEvents ?? []).map(toCustomerTrackingEvent),
    delivery: s.delivery ? toCustomerDelivery(s.delivery) : null,
  };
}

export function toCustomerTrackingEvent(e: ShipmentTrackingEvent) {
  return {
    id: e.id,
    status: e.status,
    location: e.location,
    description: e.description ?? e.notes,
    occurredAt: e.occurredAt,
  };
}

export function toCustomerDelivery(d: DeliveryRow | Delivery) {
  const row = d as DeliveryRow;
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    shipmentReference: row.shipment?.referenceNumber ?? null,
    purchaseOrderId: row.purchaseOrderId,
    purchaseOrderReference: row.purchaseOrder?.referenceNumber ?? null,
    status: row.status,
    quantity: dec(row.quantity),
    deliveredQuantity: dec(row.deliveredQuantity),
    unit: row.unit,
    scheduledDate: row.scheduledDate,
    deliveredAt: row.deliveredAt,
    confirmedAt: row.confirmedAt,
    receivedBy: row.receivedBy,
    deliveryNote: row.deliveryNote,
    hasPod: Boolean(row.podDocumentKey),
    exceptionReason: row.exceptionReason,
    exceptionNote: row.exceptionNote,
  };
}

export function toSellerDispatch(d: DispatchRow) {
  return {
    id: d.id,
    dispatchNumber: d.dispatchNumber,
    purchaseOrderId: d.purchaseOrderId,
    purchaseOrderReference: d.purchaseOrder?.referenceNumber ?? null,
    status: d.status,
    quantity: dec(d.quantity),
    unit: d.unit,
    plannedDispatchDate: d.plannedDispatchDate,
    actualDispatchDate: d.actualDispatchDate,
    loadingStartedAt: d.loadingStartedAt,
    loadingCompletedAt: d.loadingCompletedAt,
    originWarehouseId: d.originWarehouseId,
    destinationRegion: d.destinationRegion,
    vehicleId: d.vehicleId,
    driverId: d.driverId,
    buyer: {
      displayName: 'ANONYMOUS BUYER',
      reference: buyerRef(d.customerOrgId),
    },
    ewayBills: (d.ewayBills ?? []).map(toSellerEwayBill),
    shipmentId: d.shipments?.[0]?.id ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function toSellerEwayBill(e: EWayBill) {
  return {
    id: e.id,
    dispatchId: e.dispatchId,
    ewayBillNumber: e.ewayBillNumber,
    status: e.status,
    generatedAt: e.generatedAt,
    validFrom: e.validFrom,
    validUntil: e.validUntil,
    hasDocument: Boolean(e.documentKey),
    createdAt: e.createdAt,
  };
}

export function toSellerShipment(s: ShipmentRow) {
  return {
    id: s.id,
    referenceNumber: s.referenceNumber,
    purchaseOrderId: s.purchaseOrderId,
    purchaseOrderReference: s.purchaseOrder?.referenceNumber ?? null,
    dispatchId: s.dispatchId,
    dispatchNumber: s.dispatch?.dispatchNumber ?? null,
    quantity: dec(s.quantity),
    unit: s.unit,
    status: s.status,
    vehicleId: s.vehicleId,
    driverId: s.driverId,
    dispatchedAt: s.dispatchedAt,
    deliveredAt: s.deliveredAt,
    eta: s.eta,
    ewayBillNumber: s.ewayBillNumber,
    destinationRegion:
      (s.destinationSnapshot as { region?: string } | null)?.region ?? null,
    buyer: {
      displayName: 'ANONYMOUS BUYER',
      reference: buyerRef(s.customerOrgId),
    },
    trackingEvents: (s.trackingEvents ?? []).map((e) => ({
      id: e.id,
      status: e.status,
      location: e.location,
      notes: e.notes,
      description: e.description,
      source: e.source,
      occurredAt: e.occurredAt,
    })),
    delivery: s.delivery
      ? {
          id: s.delivery.id,
          status: s.delivery.status,
          quantity: dec(s.delivery.quantity),
          deliveredQuantity: dec(s.delivery.deliveredQuantity),
          deliveredAt: s.delivery.deliveredAt,
          confirmedAt: s.delivery.confirmedAt,
          hasPod: Boolean(s.delivery.podDocumentKey),
        }
      : null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toSellerDelivery(d: DeliveryRow) {
  return {
    id: d.id,
    shipmentId: d.shipmentId,
    shipmentReference: d.shipment?.referenceNumber ?? null,
    purchaseOrderId: d.purchaseOrderId,
    purchaseOrderReference: d.purchaseOrder?.referenceNumber ?? null,
    status: d.status,
    quantity: dec(d.quantity),
    deliveredQuantity: dec(d.deliveredQuantity),
    unit: d.unit,
    scheduledDate: d.scheduledDate,
    deliveredAt: d.deliveredAt,
    confirmedAt: d.confirmedAt,
    receivedBy: d.receivedBy,
    deliveryNote: d.deliveryNote,
    hasPod: Boolean(d.podDocumentKey),
    exceptionReason: d.exceptionReason,
    exceptionNote: d.exceptionNote,
    buyer: {
      displayName: 'ANONYMOUS BUYER',
      reference: buyerRef(d.customerOrgId),
    },
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function toSellerVehicle(v: Vehicle) {
  return {
    id: v.id,
    organizationId: v.organizationId,
    driverId: v.driverId,
    type: v.type,
    numberPlate: v.numberPlate,
    transporterName: v.transporterName,
    driverName: v.driverName,
    driverPhone: v.driverPhone,
    capacityMt: dec(v.capacityMt),
    status: v.status,
    insuranceExpiry: v.insuranceExpiry,
    fitnessExpiry: v.fitnessExpiry,
    permitExpiry: v.permitExpiry,
    pollutionExpiry: v.pollutionExpiry,
    isActive: v.isActive,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

export function toSellerDriver(d: Driver) {
  return {
    id: d.id,
    organizationId: d.organizationId,
    name: d.name,
    phone: d.phone,
    licenseNumber: d.licenseNumber,
    licenseExpiry: d.licenseExpiry,
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function toSellerVehicleSlot(s: VehicleSlot) {
  return {
    id: s.id,
    slotNumber: s.slotNumber,
    warehouseId: s.warehouseId,
    dispatchId: s.dispatchId,
    vehicleId: s.vehicleId,
    shipmentId: s.shipmentId,
    slotDate: s.slotDate,
    startTime: s.startTime,
    endTime: s.endTime,
    timeSlot: s.timeSlot,
    loadingBay: s.loadingBay,
    status: s.status,
    quantityMt: dec(s.quantityMt),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toAdminDispatch(
  d: DispatchRow & {
    sellerOrg?: { id: string; name: string } | null;
    customerOrg?: { id: string; name: string } | null;
  },
) {
  return {
    ...toSellerDispatch(d),
    sellerOrgId: d.sellerOrgId,
    customerOrgId: d.customerOrgId,
    sellerOrg: d.sellerOrg ?? null,
    customerOrg: d.customerOrg ?? null,
    metadata: d.metadata,
    idempotencyKey: d.idempotencyKey,
  };
}

export function toAdminShipment(
  s: ShipmentRow & {
    sellerOrg?: { id: string; name: string } | null;
    customerOrg?: { id: string; name: string } | null;
  },
) {
  return {
    ...toSellerShipment(s),
    sellerOrgId: s.sellerOrgId,
    customerOrgId: s.customerOrgId,
    sellerOrg: s.sellerOrg ?? null,
    customerOrg: s.customerOrg ?? null,
    originWarehouseId: s.originWarehouseId,
    destinationWarehouseId: s.destinationWarehouseId,
    destinationSnapshot: s.destinationSnapshot,
    metadata: s.metadata,
  };
}

export function toAdminDelivery(d: DeliveryRow) {
  return {
    ...toSellerDelivery(d),
    sellerOrgId: d.sellerOrgId,
    customerOrgId: d.customerOrgId,
    receiverPhone: d.receiverPhone,
    podDocumentKey: d.podDocumentKey,
    podDocumentId: d.podDocumentId,
    exceptionAt: d.exceptionAt,
    resolvedAt: d.resolvedAt,
    resolvedById: d.resolvedById,
    metadata: d.metadata,
  };
}

export function toAdminVehicle(v: Vehicle) {
  return toSellerVehicle(v);
}

export function toAdminEwayBill(e: EWayBill) {
  return {
    ...toSellerEwayBill(e),
    purchaseOrderId: e.purchaseOrderId,
    documentKey: e.documentKey,
    documentId: e.documentId,
    metadata: e.metadata,
  };
}
