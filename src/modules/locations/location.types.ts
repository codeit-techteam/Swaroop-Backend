export type LocationSource = 'AUTOCOMPLETE' | 'GPS' | 'MAP_PIN';

/**
 * Canonical location shape returned to every client (Customer/Seller, Web/App).
 * Clients must not re-derive these fields from raw Google payloads.
 */
export type NormalizedLocation = {
  placeId: string | null;
  /** Short human label, e.g. "Lich" or "Salt Lake Sector V". */
  name: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  addressLine1: string;
  addressLine2: string;
  landmark: string;
  locality: string;
  city: string;
  district: string;
  state: string;
  stateCode: string;
  postalCode: string;
  country: string;
  countryCode: string;
  source: LocationSource;
};

export type LocationSuggestion = {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
  types: string[];
  distanceMeters: number | null;
};

export type AddressComponentInput = {
  longText: string;
  shortText: string;
  types: string[];
};

export type LocationServiceConfig = {
  provider: 'google' | 'none';
  autocompleteEnabled: boolean;
  reverseGeocodeEnabled: boolean;
  regionCode: string;
  minQueryLength: number;
  attribution: string;
};
