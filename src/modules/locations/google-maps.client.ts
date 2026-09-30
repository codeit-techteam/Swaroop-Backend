import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  normalizeAddressComponents,
  selectReverseGeocodeResult,
  toComponents,
} from './location-normalizer.js';
import type {
  LocationSuggestion,
  NormalizedLocation,
} from './location.types.js';
import { LocationException } from './locations.errors.js';

const PLACES_BASE_URL = 'https://places.googleapis.com/v1';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Max circle radius accepted by Places Autocomplete (New) location bias. */
const LOCATION_BIAS_RADIUS_METERS = 50_000;

/** Only Essentials-tier fields — keeps Place Details on the cheapest SKU. */
const PLACE_DETAILS_FIELD_MASK = [
  'id',
  'formattedAddress',
  'addressComponents',
  'location',
  'types',
].join(',');

const AUTOCOMPLETE_FIELD_MASK = [
  'suggestions.placePrediction.placeId',
  'suggestions.placePrediction.text.text',
  'suggestions.placePrediction.structuredFormat',
  'suggestions.placePrediction.types',
  'suggestions.placePrediction.distanceMeters',
].join(',');

type AutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      types?: string[];
      distanceMeters?: number;
    };
  }>;
};

type PlaceDetailsResponse = {
  id?: string;
  formattedAddress?: string;
  addressComponents?: unknown;
  location?: { latitude?: number; longitude?: number };
};

type GeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    place_id?: string;
    formatted_address?: string;
    address_components?: unknown;
    types?: string[];
  }>;
};

@Injectable()
export class GoogleMapsClient {
  private readonly logger = new Logger(GoogleMapsClient.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  get regionCode(): string {
    return this.config.get<string>('maps.regionCode') ?? 'IN';
  }

  private get apiKey(): string {
    return this.config.get<string>('maps.serverApiKey') ?? '';
  }

  private get timeoutMs(): number {
    return this.config.get<number>('maps.requestTimeoutMs') ?? 6000;
  }

  private assertConfigured() {
    if (!this.isConfigured) {
      throw new LocationException('LOCATION_SERVICE_NOT_CONFIGURED');
    }
  }

  private async request(
    operation: string,
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      this.logger.error(
        `Google ${operation} request failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new LocationException('GOOGLE_API_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }

  private async failFromResponse(
    operation: string,
    response: Response,
    fallback: 'AUTOCOMPLETE_FAILED' | 'PLACE_NOT_FOUND' | 'GEOCODING_FAILED',
  ): Promise<never> {
    const body = await response.text().catch(() => '');
    this.logger.error(
      `Google ${operation} HTTP ${response.status}: ${body.slice(0, 500)}`,
    );
    if (response.status === 404 || response.status === 400) {
      throw new LocationException(fallback);
    }
    throw new LocationException('GOOGLE_API_UNAVAILABLE');
  }

  async autocomplete(input: {
    query: string;
    sessionToken: string;
    latitude?: number;
    longitude?: number;
  }): Promise<LocationSuggestion[]> {
    this.assertConfigured();
    const hasOrigin =
      typeof input.latitude === 'number' && typeof input.longitude === 'number';
    const origin = hasOrigin
      ? { latitude: input.latitude!, longitude: input.longitude! }
      : undefined;

    const response = await this.request(
      'autocomplete',
      `${PLACES_BASE_URL}/places:autocomplete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': AUTOCOMPLETE_FIELD_MASK,
        },
        body: JSON.stringify({
          input: input.query,
          sessionToken: input.sessionToken,
          includedRegionCodes: [this.regionCode.toLowerCase()],
          regionCode: this.regionCode.toLowerCase(),
          languageCode: 'en',
          ...(origin
            ? {
                origin,
                locationBias: {
                  circle: {
                    center: origin,
                    radius: LOCATION_BIAS_RADIUS_METERS,
                  },
                },
              }
            : {}),
        }),
      },
    );
    if (!response.ok) {
      await this.failFromResponse(
        'autocomplete',
        response,
        'AUTOCOMPLETE_FAILED',
      );
    }

    const payload = (await response.json()) as AutocompleteResponse;
    return (payload.suggestions ?? [])
      .map((row) => row.placePrediction)
      .filter((row): row is NonNullable<typeof row> => Boolean(row?.placeId))
      .map((row) => {
        const fullText = row.text?.text?.trim() ?? '';
        const primaryText =
          row.structuredFormat?.mainText?.text?.trim() ||
          fullText.split(',')[0]?.trim() ||
          fullText;
        const secondaryText =
          row.structuredFormat?.secondaryText?.text?.trim() ?? '';
        return {
          placeId: row.placeId!,
          primaryText,
          secondaryText,
          fullText:
            fullText || [primaryText, secondaryText].filter(Boolean).join(', '),
          types: row.types ?? [],
          distanceMeters:
            typeof row.distanceMeters === 'number' ? row.distanceMeters : null,
        };
      });
  }

  async placeDetails(input: {
    placeId: string;
    sessionToken?: string;
    name?: string;
  }): Promise<NormalizedLocation> {
    this.assertConfigured();
    const params = new URLSearchParams({
      languageCode: 'en',
      regionCode: this.regionCode.toLowerCase(),
    });
    if (input.sessionToken) params.set('sessionToken', input.sessionToken);

    const response = await this.request(
      'place details',
      `${PLACES_BASE_URL}/places/${encodeURIComponent(input.placeId)}?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': PLACE_DETAILS_FIELD_MASK,
        },
      },
    );
    if (!response.ok) {
      await this.failFromResponse('place details', response, 'PLACE_NOT_FOUND');
    }

    const payload = (await response.json()) as PlaceDetailsResponse;
    const latitude = payload.location?.latitude;
    const longitude = payload.location?.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      this.logger.warn(`Place ${input.placeId} returned no coordinates`);
      throw new LocationException('PLACE_NOT_FOUND');
    }

    return normalizeAddressComponents({
      components: toComponents(payload.addressComponents),
      formattedAddress: payload.formattedAddress,
      latitude,
      longitude,
      placeId: payload.id ?? input.placeId,
      name: input.name,
      source: 'AUTOCOMPLETE',
    });
  }

  async reverseGeocode(input: {
    latitude: number;
    longitude: number;
    source: 'GPS' | 'MAP_PIN';
  }): Promise<NormalizedLocation> {
    this.assertConfigured();
    const params = new URLSearchParams({
      latlng: `${input.latitude},${input.longitude}`,
      language: 'en',
      region: this.regionCode.toLowerCase(),
      key: this.apiKey,
    });
    const response = await this.request(
      'reverse geocode',
      `${GEOCODE_URL}?${params.toString()}`,
      { method: 'GET' },
    );
    if (!response.ok) {
      await this.failFromResponse(
        'reverse geocode',
        response,
        'GEOCODING_FAILED',
      );
    }

    const payload = (await response.json()) as GeocodeResponse;
    if (payload.status === 'ZERO_RESULTS') {
      throw new LocationException('GEOCODING_FAILED');
    }
    if (payload.status !== 'OK') {
      this.logger.error(
        `Google reverse geocode status ${payload.status}: ${payload.error_message ?? ''}`,
      );
      throw new LocationException('GOOGLE_API_UNAVAILABLE');
    }

    const selected = selectReverseGeocodeResult(payload.results ?? []);
    if (!selected) {
      throw new LocationException('GEOCODING_FAILED');
    }

    // Keep the device/pin coordinate: it is more precise than the geocoded centroid.
    return normalizeAddressComponents({
      components: selected.components,
      formattedAddress: selected.formattedAddress,
      latitude: input.latitude,
      longitude: input.longitude,
      placeId: selected.placeId,
      source: input.source,
    });
  }
}
