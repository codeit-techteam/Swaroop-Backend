import { describe, expect, it, vi } from 'vitest';
import type { GoogleMapsClient } from './google-maps.client.js';
import type { NormalizedLocation } from './location.types.js';
import { LocationException } from './locations.errors.js';
import { LocationsService } from './locations.service.js';

const resolved: NormalizedLocation = {
  placeId: 'ChIJplace000001',
  name: 'Lich',
  formattedAddress: 'Lich, West Bengal, India',
  latitude: 22.8,
  longitude: 88.2,
  addressLine1: 'Lich',
  addressLine2: '',
  landmark: '',
  locality: 'Lich',
  city: 'Lich',
  district: 'Hooghly',
  state: 'West Bengal',
  stateCode: 'WB',
  postalCode: '712305',
  country: 'India',
  countryCode: 'IN',
  source: 'AUTOCOMPLETE',
};

function makeService(overrides: Partial<GoogleMapsClient> = {}) {
  const client = {
    isConfigured: true,
    regionCode: 'IN',
    autocomplete: vi.fn().mockResolvedValue([]),
    placeDetails: vi.fn().mockResolvedValue(resolved),
    reverseGeocode: vi
      .fn()
      .mockResolvedValue({ ...resolved, source: 'GPS' as const }),
    ...overrides,
  } as unknown as GoogleMapsClient;
  return { service: new LocationsService(client), client };
}

describe('LocationsService', () => {
  it('skips Google for queries shorter than two characters', async () => {
    const { service, client } = makeService();
    await expect(
      service.autocomplete('u1', {
        query: ' L ',
        sessionToken: 'token-abc-123',
      }),
    ).resolves.toEqual([]);
    expect(client.autocomplete).not.toHaveBeenCalled();
  });

  it('forwards the session token and a valid location bias', async () => {
    const { service, client } = makeService();
    await service.autocomplete('u1', {
      query: 'Lich',
      sessionToken: 'token-abc-123',
      latitude: 22.57,
      longitude: 88.36,
    });
    expect(client.autocomplete).toHaveBeenCalledWith({
      query: 'Lich',
      sessionToken: 'token-abc-123',
      latitude: 22.57,
      longitude: 88.36,
    });
  });

  it('coalesces duplicate place detail lookups in the same session', async () => {
    const { service, client } = makeService();
    const input = { placeId: 'ChIJplace000001', sessionToken: 'token-abc-123' };
    await Promise.all([
      service.placeDetails('u1', input),
      service.placeDetails('u1', input),
    ]);
    await service.placeDetails('u1', { ...input, name: 'Lich Bazar' });
    expect(client.placeDetails).toHaveBeenCalledTimes(1);
  });

  it('re-uses reverse geocode results for the same rounded coordinate', async () => {
    const { service, client } = makeService();
    const first = await service.reverseGeocode('u1', {
      latitude: 22.572641,
      longitude: 88.363891,
      source: 'GPS',
    });
    const second = await service.reverseGeocode('u1', {
      latitude: 22.572642,
      longitude: 88.363892,
      source: 'MAP_PIN',
    });
    expect(client.reverseGeocode).toHaveBeenCalledTimes(1);
    expect(first.latitude).toBe(22.572641);
    expect(second.latitude).toBe(22.572642);
    expect(second.source).toBe('MAP_PIN');
  });

  it('rejects invalid coordinates before calling Google', async () => {
    const { service, client } = makeService();
    await expect(
      service.reverseGeocode('u1', {
        latitude: 0,
        longitude: 0,
        source: 'GPS',
      }),
    ).rejects.toBeInstanceOf(LocationException);
    expect(client.reverseGeocode).not.toHaveBeenCalled();
  });

  it('rate limits reverse geocode per user', async () => {
    const { service } = makeService();
    const calls = Array.from({ length: 30 }, (_, i) =>
      service.reverseGeocode('u-limit', {
        latitude: 22 + i * 0.01,
        longitude: 88,
        source: 'GPS',
      }),
    );
    await Promise.all(calls);
    await expect(
      service.reverseGeocode('u-limit', {
        latitude: 23.5,
        longitude: 88,
        source: 'GPS',
      }),
    ).rejects.toMatchObject({ code: 'LOCATION_RATE_LIMITED' });
  });

  it('reports disabled config when no server key is set', () => {
    const { service } = makeService({ isConfigured: false } as never);
    expect(service.getConfig()).toMatchObject({
      provider: 'none',
      autocompleteEnabled: false,
    });
  });
});
