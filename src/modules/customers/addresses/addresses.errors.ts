import { HttpException, HttpStatus } from '@nestjs/common';

export const ADDRESS_ERROR_STATUS: Record<string, number> = {
  ADDRESS_NOT_FOUND: HttpStatus.NOT_FOUND,
  ADDRESS_LIMIT_REACHED: HttpStatus.CONFLICT,
  INVALID_PINCODE: HttpStatus.BAD_REQUEST,
  INVALID_COORDINATES: HttpStatus.BAD_REQUEST,
};

export class AddressException extends HttpException {
  readonly code: string;

  constructor(code: string, message?: string, details?: unknown) {
    const status = ADDRESS_ERROR_STATUS[code] ?? HttpStatus.BAD_REQUEST;
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
