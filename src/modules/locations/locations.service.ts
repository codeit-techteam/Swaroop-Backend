import { Injectable } from '@nestjs/common';
import { GoogleMapsClient } from './google-maps.client.js';
import { isValidCoordinate } from './location-normalizer.js';
import type {
  LocationServiceConfig,
  LocationSuggestion,
  NormalizedLocation,
} from './location.types.js';
import { LocationException } from './locations.errors.js';
import { KeyedRateLimiter, TtlCache } from './ttl-cache.js';

export const MIN_AUTOCOMPLETE_QUERY_LENGTH = 2;

@Injectable()
export class LocationsService {
  private readonly autocompleteLimiter = new KeyedRateLimiter(120, 60_000);
  private readonly detailsLimiter = new KeyedRateLimiter(40, 60_000);
  private readonly reverseLimiter = new KeyedRateLimiter(30, 60_000);

  /** Coalesces double-taps on the same suggestion within one session. */
  private readonly detailsCache = new TtlCache<NormalizedLocation>(
    5 * 60_000,
    2_000,
  );
  /** Rounded to ~1 m so GPS jitter re-uses one lookup. */
  private readonly reverseCache = new TtlCache<NormalizedLocation>(
    10 * 60_000,
    5_000,
  );

  constructor(private readonly google: GoogleMapsClient) {}

  getConfig(): LocationServiceConfig {
    const enabled = this.google.isConfigured;
    return {
      provider: enabled ? 'google' : 'none',
      autocompleteEnabled: enabled,
      reverseGeocodeEnabled: enabled,
      regionCode: this.google.regionCode,
      minQueryLength: MIN_AUTOCOMPLETE_QUERY_LENGTH,
      attribution: 'Powered by Google',
    };
  }

  private consume(limiter: KeyedRateLimiter, userId: string) {
    if (!limiter.tryConsume(userId)) {
      throw new LocationException('LOCATION_RATE_LIMITED');
    }
  }

  async autocomplete(
    userId: string,
    input: {
      query: string;
      sessionToken: string;
      latitude?: number;
      longitude?: number;
    },
  ): Promise<LocationSuggestion[]> {
    const query = input.query.replace(/\s+/g, ' ').trim();
    if (query.length < MIN_AUTOCOMPLETE_QUERY_LENGTH) return [];
    this.consume(this.autocompleteLimiter, userId);

    const bias =
      input.latitude != null &&
      input.longitude != null &&
      isValidCoordinate(input.latitude, input.longitude)
        ? { latitude: input.latitude, longitude: input.longitude }
        : {};

    return this.google.autocomplete({
      query,
      sessionToken: input.sessionToken,
      ...bias,
    });
  }

  async placeDetails(
    userId: string,
    input: { placeId: string; sessionToken?: string; name?: string },
  ): Promise<NormalizedLocation> {
    const key = `${input.placeId}|${input.sessionToken ?? ''}`;
    const cached = this.detailsCache.get(key);
    if (cached) return { ...cached, name: input.name?.trim() || cached.name };
    this.consume(this.detailsLimiter, userId);
    return this.detailsCache.getOrLoad(key, () =>
      this.google.placeDetails(input),
    );
  }

  async reverseGeocode(
    userId: string,
    input: { latitude: number; longitude: number; source: 'GPS' | 'MAP_PIN' },
  ): Promise<NormalizedLocation> {
    if (!isValidCoordinate(input.latitude, input.longitude)) {
      throw new LocationException('INVALID_COORDINATES');
    }
    const key = `${input.latitude.toFixed(5)},${input.longitude.toFixed(5)}`;
    const cached = this.reverseCache.get(key);
    if (cached) {
      return {
        ...cached,
        latitude: input.latitude,
        longitude: input.longitude,
        source: input.source,
      };
    }
    this.consume(this.reverseLimiter, userId);
    const resolved = await this.reverseCache.getOrLoad(key, () =>
      this.google.reverseGeocode(input),
    );
    return {
      ...resolved,
      latitude: input.latitude,
      longitude: input.longitude,
      source: input.source,
    };
  }
}
