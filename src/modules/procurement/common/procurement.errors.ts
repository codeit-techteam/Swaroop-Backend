import {
  BadRequestException,
  ConflictException,
  HttpException,
} from '@nestjs/common';

export const PROCUREMENT_ERROR_CODES = [
  'PURCHASE_REQUEST_EXPIRED',
  'PURCHASE_REQUEST_ALREADY_RESPONDED',
  'INVALID_STATUS_TRANSITION',
  'INVALID_COUNTER_OFFER',
  'COUNTER_OFFER_EXPIRED',
  'COUNTER_OFFER_NOT_FOUND',
  'MOQ_NOT_MET',
  'INSUFFICIENT_AVAILABILITY',
  'PRODUCT_UNAVAILABLE',
  'OFFER_EXPIRED',
  'PO_ALREADY_CREATED',
  'UNAUTHORIZED_SELLER',
  'UNAUTHORIZED_CUSTOMER',
] as const;

export type ProcurementErrorCode = (typeof PROCUREMENT_ERROR_CODES)[number];

const CONFLICT_CODES = new Set<ProcurementErrorCode>([
  'PURCHASE_REQUEST_EXPIRED',
  'PURCHASE_REQUEST_ALREADY_RESPONDED',
  'PO_ALREADY_CREATED',
]);

/**
 * Domain exception for procurement workflow.
 * Uses 409 Conflict for expiry / already-responded / PO-exists cases;
 * 400 Bad Request for invalid transitions and validation failures.
 */
export class ProcurementException extends HttpException {
  readonly code: ProcurementErrorCode;

  constructor(code: ProcurementErrorCode, message?: string) {
    const payload = { code, message: message ?? code };
    const status = CONFLICT_CODES.has(code) ? 409 : 400;
    super(payload, status);
    this.code = code;
  }

  static conflict(
    code: Extract<
      ProcurementErrorCode,
      | 'PURCHASE_REQUEST_EXPIRED'
      | 'PURCHASE_REQUEST_ALREADY_RESPONDED'
      | 'PO_ALREADY_CREATED'
    >,
    message?: string,
  ): never {
    throw new ConflictException({ code, message: message ?? code });
  }

  static badRequest(code: ProcurementErrorCode, message?: string): never {
    throw new BadRequestException({ code, message: message ?? code });
  }
}
