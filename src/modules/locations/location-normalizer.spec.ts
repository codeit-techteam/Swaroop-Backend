import { describe, expect, it } from 'vitest';
import {
  isValidCoordinate,
  isWithinIndia,
  normalizeAddressComponents,
  selectReverseGeocodeResult,
  toComponents,
} from './location-normalizer.js';

const placesComponents = toComponents([
  { longText: '12', shortText: '12', types: ['street_number'] },
  { longText: 'Park Street', shortText: 'Park St', types: ['route'] },
  {
    longText: 'Park Circus',
    shortText: 'Park Circus',
    types: ['sublocality_level_1', 'sublocality', 'political'],
  },
  {
    longText: 'Kolkata',
    shortText: 'Kolkata',
    types: ['locality', 'political'],
  },
  {
    longText: 'Kolkata',
    shortText: 'Kolkata',
    types: ['administrative_area_level_3', 'political'],
  },
  {
    longText: 'West Bengal',
    shortText: 'WB',
    types: ['administrative_area_level_1', 'political'],
  },
  { longText: 'India', shortText: 'IN', types: ['country', 'political'] },
  { longText: '700016', shortText: '700016', types: ['postal_code'] },
]);

describe('location normalizer', () => {
  it('maps Places (New) components into the canonical shape', () => {
    const result = normalizeAddressComponents({
      components: placesComponents,
      formattedAddress:
        '12, Park St, Park Circus, Kolkata, West Bengal 700016, India',
      latitude: 22.5512345678,
      longitude: 88.3521,
      placeId: 'ChIJabcdefghij',
      name: 'Park Street',
      source: 'AUTOCOMPLETE',
    });

    expect(result).toMatchObject({
      placeId: 'ChIJabcdefghij',
      name: 'Park Street',
      addressLine1: '12 Park Street',
      addressLine2: 'Park Circus',
      locality: 'Park Circus',
      city: 'Kolkata',
      district: 'Kolkata',
      state: 'West Bengal',
      stateCode: 'WB',
      postalCode: '700016',
      country: 'India',
      countryCode: 'IN',
      source: 'AUTOCOMPLETE',
    });
    expect(result.latitude).toBe(22.5512346);
  });

  it('accepts Geocoding API long_name/short_name components', () => {
    const components = toComponents([
      { long_name: 'Lich', short_name: 'Lich', types: ['locality'] },
      {
        long_name: 'Hooghly',
        short_name: 'Hooghly',
        types: ['administrative_area_level_3'],
      },
      {
        long_name: 'West Bengal',
        short_name: 'WB',
        types: ['administrative_area_level_1'],
      },
      { long_name: '712305', short_name: '712305', types: ['postal_code'] },
      { long_name: 'India', short_name: 'IN', types: ['country'] },
    ]);
    const result = normalizeAddressComponents({
      components,
      formattedAddress: 'Lich, West Bengal 712305, India',
      latitude: 22.8,
      longitude: 88.2,
      source: 'GPS',
    });
    expect(result.city).toBe('Lich');
    expect(result.district).toBe('Hooghly');
    expect(result.postalCode).toBe('712305');
    // Leading segment equals the city, so line1 falls back to the place name.
    expect(result.addressLine1).toBe('Lich');
    expect(result.name).toBe('Lich');
  });

  it('never uses a plus code as the street line', () => {
    const result = normalizeAddressComponents({
      components: toComponents([
        { longText: 'Howrah', shortText: 'Howrah', types: ['locality'] },
      ]),
      formattedAddress: 'H7Q2+3F Howrah, West Bengal',
      latitude: 22.58,
      longitude: 88.31,
      source: 'MAP_PIN',
    });
    expect(result.addressLine1).toBe('Howrah');
  });

  it('prefers a non plus-code reverse geocode result and fills missing PIN', () => {
    const selected = selectReverseGeocodeResult([
      {
        types: ['plus_code'],
        formatted_address: 'H7Q2+3F',
        address_components: [],
      },
      {
        place_id: 'ChIJroute123456',
        types: ['route'],
        formatted_address: 'GT Road, Howrah',
        address_components: [
          { long_name: 'GT Road', short_name: 'GT Rd', types: ['route'] },
          { long_name: 'Howrah', short_name: 'Howrah', types: ['locality'] },
        ],
      },
      {
        types: ['postal_code'],
        address_components: [
          { long_name: '711101', short_name: '711101', types: ['postal_code'] },
        ],
      },
    ]);
    expect(selected?.placeId).toBe('ChIJroute123456');
    expect(
      selected?.components.find((c) => c.types.includes('postal_code'))
        ?.longText,
    ).toBe('711101');
  });

  it('validates coordinates and India bounds', () => {
    expect(isValidCoordinate(22.5, 88.3)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 88)).toBe(false);
    expect(isWithinIndia(22.5, 88.3)).toBe(true);
    expect(isWithinIndia(51.5, -0.12)).toBe(false);
  });
});
