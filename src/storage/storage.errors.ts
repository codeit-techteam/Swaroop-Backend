import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Thrown when an actual object-storage operation is requested
 * while STORAGE_PROVIDER=none or R2 credentials are incomplete.
 */
export class StorageNotConfiguredException extends ServiceUnavailableException {
  constructor(
    message = 'File storage is not configured yet. Set STORAGE_PROVIDER=r2 and R2 credentials to enable uploads/downloads.',
  ) {
    super({
      code: 'STORAGE_NOT_CONFIGURED',
      message,
      error: 'Service Unavailable',
    });
  }
}
