import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthErrorCode } from '../types/auth.types.js';

export class AuthException extends HttpException {
  constructor(
    code: AuthErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.UNAUTHORIZED,
  ) {
    super(
      {
        message,
        error: HttpStatus[status] ?? 'Error',
        code,
      },
      status,
    );
  }
}
