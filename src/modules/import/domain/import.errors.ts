import { HttpException, HttpStatus } from '@nestjs/common';

export type ImportErrorCode =
  | 'IMPORT_FEATURE_DISABLED'
  | 'IMPORT_VALIDATION_FAILED'
  | 'IMPORT_NOT_FOUND'
  | 'IMPORT_UNAUTHORIZED'
  | 'IMPORT_PROFILE_REQUIRED'
  | 'IMPORT_ACCOUNT_NOT_APPROVED'
  | 'IMPORT_ALREADY_PUBLISHED'
  | 'IMPORT_ALREADY_EXPIRED'
  | 'IMPORT_INVALID_STATUS_TRANSITION'
  | 'IMPORT_DRAFT_CONFLICT'
  | 'INVALID_SHIPMENT_WINDOW'
  | 'INVALID_QUANTITY'
  | 'INVALID_PRICE'
  | 'INVALID_CURRENCY'
  | 'INVALID_INCOTERM'
  | 'INVALID_PAYMENT_TERM'
  | 'INVALID_PORT'
  | 'INVALID_MASTER_REFERENCE'
  | 'DUPLICATE_REQUEST'
  | 'NEGOTIATION_NOT_ALLOWED'
  | 'NEGOTIATION_NOT_FOUND'
  | 'OFFER_EXPIRED'
  | 'DEAL_NOT_FOUND'
  | 'IMPORT_MASTER_CONFLICT';

const STATUS: Record<ImportErrorCode, number> = {
  IMPORT_FEATURE_DISABLED: HttpStatus.SERVICE_UNAVAILABLE,
  IMPORT_VALIDATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  IMPORT_NOT_FOUND: HttpStatus.NOT_FOUND,
  IMPORT_UNAUTHORIZED: HttpStatus.FORBIDDEN,
  IMPORT_PROFILE_REQUIRED: HttpStatus.FORBIDDEN,
  IMPORT_ACCOUNT_NOT_APPROVED: HttpStatus.FORBIDDEN,
  IMPORT_ALREADY_PUBLISHED: HttpStatus.CONFLICT,
  IMPORT_ALREADY_EXPIRED: HttpStatus.CONFLICT,
  IMPORT_INVALID_STATUS_TRANSITION: HttpStatus.CONFLICT,
  IMPORT_DRAFT_CONFLICT: HttpStatus.CONFLICT,
  INVALID_SHIPMENT_WINDOW: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_QUANTITY: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_PRICE: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_CURRENCY: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_INCOTERM: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_PAYMENT_TERM: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_PORT: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_MASTER_REFERENCE: HttpStatus.UNPROCESSABLE_ENTITY,
  DUPLICATE_REQUEST: HttpStatus.CONFLICT,
  NEGOTIATION_NOT_ALLOWED: HttpStatus.CONFLICT,
  NEGOTIATION_NOT_FOUND: HttpStatus.NOT_FOUND,
  OFFER_EXPIRED: HttpStatus.CONFLICT,
  DEAL_NOT_FOUND: HttpStatus.NOT_FOUND,
  IMPORT_MASTER_CONFLICT: HttpStatus.CONFLICT,
};

const MESSAGES: Record<ImportErrorCode, string> = {
  IMPORT_FEATURE_DISABLED: 'Import trading is not available right now.',
  IMPORT_VALIDATION_FAILED: 'Some Import details are missing or invalid.',
  IMPORT_NOT_FOUND: 'This Import record was not found.',
  IMPORT_UNAUTHORIZED: 'You are not allowed to perform this Import action.',
  IMPORT_PROFILE_REQUIRED:
    'Complete your business profile before using Import trading.',
  IMPORT_ACCOUNT_NOT_APPROVED:
    'Your account must be verified before it can trade on Import.',
  IMPORT_ALREADY_PUBLISHED: 'This record has already been published.',
  IMPORT_ALREADY_EXPIRED: 'This record has expired.',
  IMPORT_INVALID_STATUS_TRANSITION:
    'This action is not allowed in the current status.',
  IMPORT_DRAFT_CONFLICT:
    'This record was changed elsewhere. Reload it before saving again.',
  INVALID_SHIPMENT_WINDOW:
    'Earliest shipment date must be on or before the latest shipment date.',
  INVALID_QUANTITY: 'Quantity details are invalid.',
  INVALID_PRICE: 'Price details are invalid.',
  INVALID_CURRENCY: 'The selected currency is not available for Import.',
  INVALID_INCOTERM: 'The selected Incoterm is not available.',
  INVALID_PAYMENT_TERM:
    'The selected payment term is not available for this currency.',
  INVALID_PORT: 'The selected port is not available.',
  INVALID_MASTER_REFERENCE:
    'One of the selected options is no longer available.',
  DUPLICATE_REQUEST: 'This request was already submitted.',
  NEGOTIATION_NOT_ALLOWED: 'Negotiation is not allowed right now.',
  NEGOTIATION_NOT_FOUND: 'Negotiation not found.',
  OFFER_EXPIRED: 'This offer has expired.',
  DEAL_NOT_FOUND: 'Deal not found.',
  IMPORT_MASTER_CONFLICT: 'A record with this code already exists.',
};

export type ImportFieldError = {
  field: string;
  code: ImportErrorCode | 'REQUIRED' | 'FIELD_LOCKED';
  message: string;
};

export class ImportException extends HttpException {
  readonly code: ImportErrorCode;

  constructor(code: ImportErrorCode, message?: string, details?: unknown) {
    super(
      {
        code,
        message: message ?? MESSAGES[code],
        ...(details !== undefined ? { details } : {}),
      },
      STATUS[code],
    );
    this.code = code;
  }
}

/**
 * Throw one structured error for a list of field errors. When every error
 * shares one specific code (e.g. INVALID_SHIPMENT_WINDOW) that code is used,
 * otherwise IMPORT_VALIDATION_FAILED.
 */
export function throwFieldErrors(errors: ImportFieldError[]): void {
  if (!errors.length) return;
  const specific = new Set(
    errors
      .map((e) => e.code)
      .filter(
        (c): c is ImportErrorCode => c !== 'REQUIRED' && c !== 'FIELD_LOCKED',
      ),
  );
  const allSpecific =
    specific.size === 1 &&
    errors.every((e) => specific.has(e.code as ImportErrorCode));
  const code = allSpecific ? [...specific][0] : 'IMPORT_VALIDATION_FAILED';
  const message = errors.length === 1 ? errors[0].message : MESSAGES[code];
  throw new ImportException(code, message, errors);
}
