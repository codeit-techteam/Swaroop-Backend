import type { Address, AddressType } from '../../../generated/prisma/client.js';

export type AddressBookEntryDto = {
  id: string;
  type: AddressType;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  landmark: string | null;
  locality: string | null;
  district: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  formattedAddress: string | null;
  accuracyMeters: number | null;
  source: string | null;
  isDefault: boolean;
};

/** Immutable address copy persisted on PRs / POs so later edits never rewrite history. */
export type AddressSnapshot = {
  addressId: string;
  type: AddressType;
  label: string;
  line1: string;
  line2: string | null;
  landmark: string | null;
  locality: string | null;
  city: string;
  district: string | null;
  state: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  formattedAddress: string;
  capturedAt: string;
};

export const MAX_ORGANIZATION_ADDRESSES = 20;
export const DUPLICATE_DISTANCE_METERS = 50;

export function normalizeLine(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function normalizePincode(value?: string | null): string {
  return (value ?? '').replace(/\D/g, '').slice(0, 6);
}

export function normalizeCountryCode(value?: string | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || /^india$/i.test(trimmed)) return 'IN';
  return trimmed.toUpperCase().slice(0, 8);
}

export function toCoordinate(value: unknown): number | null {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isDuplicateAddress(
  left: {
    line1: string;
    postalCode: string;
    latitude?: number | null;
    longitude?: number | null;
  },
  right: {
    line1: string;
    postalCode: string;
    latitude?: number | null;
    longitude?: number | null;
  },
): boolean {
  const samePincode =
    normalizePincode(left.postalCode) === normalizePincode(right.postalCode);
  const sameLine =
    normalizeLine(left.line1).length > 0 &&
    normalizeLine(left.line1) === normalizeLine(right.line1);

  if (samePincode && sameLine) {
    return true;
  }

  if (
    left.latitude != null &&
    left.longitude != null &&
    right.latitude != null &&
    right.longitude != null
  ) {
    return (
      haversineMeters(
        left.latitude,
        left.longitude,
        right.latitude,
        right.longitude,
      ) <= DUPLICATE_DISTANCE_METERS
    );
  }

  return false;
}

export function toAddressBookDto(row: Address): AddressBookEntryDto {
  return {
    id: row.id,
    type: row.type,
    label: row.label?.trim() || row.city,
    line1: row.line1,
    line2: row.line2,
    city: row.city,
    state: row.state,
    country: row.country,
    postalCode: row.postalCode,
    landmark: row.landmark,
    locality: row.locality,
    district: row.district,
    latitude: toCoordinate(row.latitude),
    longitude: toCoordinate(row.longitude),
    placeId: row.placeId,
    formattedAddress: row.formattedAddress,
    accuracyMeters: row.accuracyMeters,
    source: row.source,
    isDefault: row.isDefault,
  };
}

export function buildAddressSnapshot(
  row: Address,
  capturedAt = new Date(),
): AddressSnapshot {
  const formatted =
    row.formattedAddress?.trim() ||
    [row.line1, row.line2, row.landmark, row.city, row.state, row.postalCode]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(', ');
  return {
    addressId: row.id,
    type: row.type,
    label: row.label?.trim() || row.city,
    line1: row.line1,
    line2: row.line2,
    landmark: row.landmark,
    locality: row.locality,
    city: row.city,
    district: row.district,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    latitude: toCoordinate(row.latitude),
    longitude: toCoordinate(row.longitude),
    placeId: row.placeId,
    formattedAddress: formatted,
    capturedAt: capturedAt.toISOString(),
  };
}
