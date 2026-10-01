import type {
  AddressComponentInput,
  LocationSource,
  NormalizedLocation,
} from './location.types.js';

/** Generous India bounding box (includes A&N and Lakshadweep). */
export const INDIA_BOUNDS = {
  minLat: 6.0,
  maxLat: 37.6,
  minLng: 68.0,
  maxLng: 97.6,
} as const;

export function isWithinIndia(latitude: number, longitude: number): boolean {
  return (
    latitude >= INDIA_BOUNDS.minLat &&
    latitude <= INDIA_BOUNDS.maxLat &&
    longitude >= INDIA_BOUNDS.minLng &&
    longitude <= INDIA_BOUNDS.maxLng
  );
}

export function isValidCoordinate(latitude: unknown, longitude: unknown) {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    !(latitude === 0 && longitude === 0)
  );
}

const PLUS_CODE_REGEX = /^[A-Z0-9]{4}\+[A-Z0-9]{2,3}/;
const BARE_NUMBER_REGEX = /^[\d\s/-]+[A-Za-z]?$/;

function isBareNumber(value: string) {
  return BARE_NUMBER_REGEX.test(value);
}

function first(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function same(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Accepts both Places API (New) `{longText}` and Geocoding `{long_name}` shapes. */
export function toComponents(raw: unknown): AddressComponentInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const row = (entry ?? {}) as Record<string, unknown>;
      const longText = String(row.longText ?? row.long_name ?? '').trim();
      const shortText = String(
        row.shortText ?? row.short_name ?? longText,
      ).trim();
      const types = Array.isArray(row.types)
        ? row.types.map((t) => String(t))
        : [];
      return { longText, shortText, types };
    })
    .filter((row) => row.longText.length > 0);
}

export function normalizeAddressComponents(input: {
  components: AddressComponentInput[];
  formattedAddress?: string | null;
  latitude: number;
  longitude: number;
  placeId?: string | null;
  name?: string | null;
  source: LocationSource;
}): NormalizedLocation {
  const pick = (type: string, short = false) => {
    const hit = input.components.find((c) => c.types.includes(type));
    return (short ? hit?.shortText : hit?.longText) ?? '';
  };

  const streetNumber = pick('street_number');
  const route = pick('route');
  const premise = first(pick('premise'), pick('subpremise'));
  const neighborhood = pick('neighborhood');
  const sublocality3 = pick('sublocality_level_3');
  const sublocality2 = pick('sublocality_level_2');
  const sublocality1 = first(pick('sublocality_level_1'), pick('sublocality'));
  const localityRaw = pick('locality');
  const adminL3 = pick('administrative_area_level_3');
  const adminL2 = pick('administrative_area_level_2');
  const state = pick('administrative_area_level_1');
  const stateCode = pick('administrative_area_level_1', true);
  const postalCode = pick('postal_code').replace(/\D/g, '').slice(0, 6);
  const country = first(pick('country'), 'India');
  const countryCode = first(pick('country', true), 'IN').toUpperCase();
  const landmark = first(pick('landmark'), pick('point_of_interest'));

  const city = first(
    localityRaw,
    pick('postal_town'),
    adminL3,
    adminL2,
    sublocality1,
  );
  const district = first(adminL3, adminL2);
  const locality = first(sublocality1, neighborhood, localityRaw);

  // A street number without a route (e.g. "3") is not a usable street line.
  const street = route ? [streetNumber, route].filter(Boolean).join(' ') : '';
  const formatted = (input.formattedAddress ?? '').trim();
  const areaNames = [
    neighborhood,
    sublocality3,
    sublocality2,
    sublocality1,
    localityRaw,
    city,
    district,
    state,
    country,
  ].filter(Boolean);
  const isArea = (segment: string) =>
    areaNames.some((area) => same(segment, area)) ||
    (Boolean(state) && segment.startsWith(`${state} `)) ||
    /^\d{6}$/.test(segment);

  // Building / plot segments that precede the first known area in the
  // formatted address. A bare house number keeps the next segment with it.
  // Segments are only trusted once a known area confirms where they end.
  const buildingParts: string[] = [];
  let reachedArea = false;
  for (const segment of formatted.split(',').map((part) => part.trim())) {
    if (!segment || PLUS_CODE_REGEX.test(segment)) continue;
    if (/^near\s/i.test(segment)) continue;
    if (!isArea(segment)) {
      buildingParts.push(segment);
      continue;
    }
    reachedArea = true;
    if (buildingParts.length > 0 && buildingParts.every(isBareNumber)) {
      buildingParts.push(segment);
    }
    break;
  }
  const buildingLine =
    reachedArea && !buildingParts.every(isBareNumber)
      ? buildingParts.join(', ')
      : '';

  // A bare plot number ("601") only reads as an address next to a street.
  const line1Parts =
    street || !isBareNumber(premise) ? [premise, street].filter(Boolean) : [];
  const placeName =
    input.name && !isBareNumber(input.name.trim()) ? input.name : '';
  const addressLine1 = first(
    line1Parts.join(', '),
    buildingLine,
    placeName,
    locality,
    city,
  );

  const line2Candidates = [
    neighborhood,
    sublocality3,
    sublocality2,
    sublocality1,
  ].filter(
    (value, index, all) =>
      Boolean(value) &&
      all.findIndex((other) => same(other, value)) === index &&
      !same(value, city) &&
      !addressLine1.toLowerCase().includes(value.toLowerCase()),
  );
  const addressLine2 = line2Candidates.join(', ');

  const name = first(
    input.name,
    premise,
    route,
    sublocality1,
    neighborhood,
    localityRaw,
    city,
  );

  return {
    placeId: input.placeId?.trim() || null,
    name,
    formattedAddress:
      formatted ||
      [addressLine1, addressLine2, city, state, postalCode]
        .filter(Boolean)
        .join(', '),
    latitude: Number(input.latitude.toFixed(7)),
    longitude: Number(input.longitude.toFixed(7)),
    addressLine1,
    addressLine2,
    landmark,
    locality,
    city,
    district,
    state,
    stateCode,
    postalCode,
    country,
    countryCode,
    source: input.source,
  };
}

type GeocodeResult = {
  place_id?: string;
  formatted_address?: string;
  address_components?: unknown;
  types?: string[];
};

/**
 * Picks the most specific reverse-geocode result (skipping plus codes) and
 * fills missing components such as postal code from broader results.
 */
export function selectReverseGeocodeResult(results: GeocodeResult[]): {
  placeId: string | null;
  formattedAddress: string;
  components: AddressComponentInput[];
} | null {
  const usable = results.filter(
    (row) => !(row.types ?? []).includes('plus_code'),
  );
  const primary = usable[0];
  if (!primary) return null;

  const components = toComponents(primary.address_components);
  const has = (type: string) => components.some((c) => c.types.includes(type));
  const fillTypes = [
    'postal_code',
    'locality',
    'administrative_area_level_1',
    'administrative_area_level_2',
    'administrative_area_level_3',
    'sublocality_level_1',
    'country',
  ];

  for (const type of fillTypes) {
    if (has(type)) continue;
    for (const row of usable.slice(1)) {
      const hit = toComponents(row.address_components).find((c) =>
        c.types.includes(type),
      );
      if (hit) {
        components.push(hit);
        break;
      }
    }
  }

  return {
    placeId: primary.place_id ?? null,
    formattedAddress: primary.formatted_address ?? '',
    components,
  };
}
