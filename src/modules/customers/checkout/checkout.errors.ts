import { HttpException, HttpStatus } from '@nestjs/common';

export const CHECKOUT_ERROR_STATUS: Record<string, number> = {
  PRODUCT_NOT_FOUND: HttpStatus.NOT_FOUND,
  OFFER_NOT_FOUND: HttpStatus.NOT_FOUND,
  ADDRESS_NOT_FOUND: HttpStatus.NOT_FOUND,
  QUOTE_NOT_FOUND: HttpStatus.NOT_FOUND,
  QUOTE_EXPIRED: HttpStatus.CONFLICT,
  QUOTE_CHANGED: HttpStatus.CONFLICT,
  QUOTE_CONSUMED: HttpStatus.CONFLICT,
  CREDIT_NOT_ELIGIBLE: HttpStatus.CONFLICT,
  CREDIT_LIMIT_EXCEEDED: HttpStatus.CONFLICT,
  PAYMENT_OPTION_UNAVAILABLE: HttpStatus.BAD_REQUEST,
  INVALID_QUANTITY: HttpStatus.BAD_REQUEST,
  MOQ_NOT_MET: HttpStatus.BAD_REQUEST,
  INVALID_QUANTITY_INCREMENT: HttpStatus.BAD_REQUEST,
  INSUFFICIENT_INVENTORY: HttpStatus.CONFLICT,
  NO_MATCHING_SELLER: HttpStatus.CONFLICT,
};

export class CheckoutException extends HttpException {
  readonly code: string;

  constructor(code: string, message?: string, details?: unknown) {
    const status = CHECKOUT_ERROR_STATUS[code] ?? HttpStatus.BAD_REQUEST;
    super(
      {
        code,
        message: message ?? code,
        ...(details !== undefined ? { details } : {}),
      },
      status,
    );
    this.code = code;
  }
}
