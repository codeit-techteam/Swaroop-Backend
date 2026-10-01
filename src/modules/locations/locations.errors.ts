import { HttpException, HttpStatus } from '@nestjs/common';

export type LocationErrorCode =
  | 'LOCATION_SERVICE_NOT_CONFIGURED'
  | 'GOOGLE_API_UNAVAILABLE'
  | 'AUTOCOMPLETE_FAILED'
  | 'PLACE_NOT_FOUND'
  | 'GEOCODING_FAILED'
  | 'INVALID_COORDINATES'
  | 'LOCATION_OUTSIDE_SERVICE_AREA'
  | 'LOCATION_RATE_LIMITED';

const STATUS: Record<LocationErrorCode, number> = {
  LOCATION_SERVICE_NOT_CONFIGURED: HttpStatus.SERVICE_UNAVAILABLE,
  GOOGLE_API_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  AUTOCOMPLETE_FAILED: HttpStatus.BAD_GATEWAY,
  PLACE_NOT_FOUND: HttpStatus.NOT_FOUND,
  GEOCODING_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_COORDINATES: HttpStatus.BAD_REQUEST,
  LOCATION_OUTSIDE_SERVICE_AREA: HttpStatus.UNPROCESSABLE_ENTITY,
  LOCATION_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
};

/** Customer-safe messages — raw Google errors are only logged server-side. */
const MESSAGES: Record<LocationErrorCode, string> = {
  LOCATION_SERVICE_NOT_CONFIGURED:
    'Address search is temporarily unavailable. Please enter your address manually.',
  GOOGLE_API_UNAVAILABLE:
    'Address search is temporarily unavailable. Please try again or enter your address manually.',
  AUTOCOMPLETE_FAILED:
    'Unable to load address suggestions right now. Please try again.',
  PLACE_NOT_FOUND:
    'We could not find that place. Please pick another suggestion.',
  GEOCODING_FAILED:
    'Unable to resolve an address for this location. Please search for your address manually.',
  INVALID_COORDINATES: 'The selected location coordinates are invalid.',
  LOCATION_OUTSIDE_SERVICE_AREA:
    'This location is outside India. Please choose an Indian delivery address.',
  LOCATION_RATE_LIMITED:
    'Too many address lookups. Please wait a moment and try again.',
};

export class LocationException extends HttpException {
  readonly code: LocationErrorCode;

  constructor(code: LocationErrorCode, message?: string) {
    super({ code, message: message ?? MESSAGES[code] }, STATUS[code]);
    this.code = code;
  }
}
