import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';

export const FINANCE_ERROR_CODES = [
  'CREDIT_NOT_AVAILABLE',
  'CREDIT_LIMIT_EXCEEDED',
  'PROFORMA_NOT_FOUND',
  'PROFORMA_CANCELLED',
  'PAYMENT_SCHEDULE_NOT_FOUND',
  'PAYMENT_NOT_FOUND',
  'PAYMENT_AMOUNT_INVALID',
  'PAYMENT_OVERPAYMENT',
  'INSUFFICIENT_SCHEDULE_REMAINING',
  'INVALID_PAYMENT_STATUS',
  'INVALID_PAYMENT_TRANSITION',
  'UTR_ALREADY_USED',
  'UTR_REQUIRED',
  'UNAUTHORIZED_CUSTOMER',
  'UNAUTHORIZED_SELLER',
  'PURCHASE_ORDER_NOT_FOUND',
  'PAYMENT_ALREADY_VERIFIED',
  'PAYMENT_NOT_UNDER_VERIFICATION',
  'IDEMPOTENCY_CONFLICT',
  'SETTLEMENT_NOT_FOUND',
  'INVOICE_NOT_FOUND',
] as const;

export type FinanceErrorCode = (typeof FINANCE_ERROR_CODES)[number];

const CONFLICT_CODES = new Set<FinanceErrorCode>([
  'UTR_ALREADY_USED',
  'PAYMENT_ALREADY_VERIFIED',
  'IDEMPOTENCY_CONFLICT',
  'CREDIT_NOT_AVAILABLE',
  'CREDIT_LIMIT_EXCEEDED',
]);

const FORBIDDEN_CODES = new Set<FinanceErrorCode>([
  'UNAUTHORIZED_CUSTOMER',
  'UNAUTHORIZED_SELLER',
]);

const NOT_FOUND_CODES = new Set<FinanceErrorCode>([
  'PROFORMA_NOT_FOUND',
  'PAYMENT_NOT_FOUND',
  'PAYMENT_SCHEDULE_NOT_FOUND',
  'PURCHASE_ORDER_NOT_FOUND',
  'SETTLEMENT_NOT_FOUND',
  'INVOICE_NOT_FOUND',
]);

/**
 * Domain exception for payment & finance workflow.
 * 409 for verification/UTR/credit conflicts; 403 ownership; 404 missing; 400 otherwise.
 */
export class FinanceException extends HttpException {
  readonly code: FinanceErrorCode;

  constructor(code: FinanceErrorCode, message?: string) {
    const payload = { code, message: message ?? code };
    let status = 400;
    if (CONFLICT_CODES.has(code)) status = 409;
    else if (FORBIDDEN_CODES.has(code)) status = 403;
    else if (NOT_FOUND_CODES.has(code)) status = 404;
    super(payload, status);
    this.code = code;
  }

  static conflict(code: FinanceErrorCode, message?: string): never {
    throw new ConflictException({ code, message: message ?? code });
  }

  static badRequest(code: FinanceErrorCode, message?: string): never {
    throw new BadRequestException({ code, message: message ?? code });
  }

  static forbidden(code: FinanceErrorCode, message?: string): never {
    throw new ForbiddenException({ code, message: message ?? code });
  }

  static notFound(code: FinanceErrorCode, message?: string): never {
    throw new NotFoundException({ code, message: message ?? code });
  }
}
