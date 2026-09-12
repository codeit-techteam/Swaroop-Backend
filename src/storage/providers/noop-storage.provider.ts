import { Injectable, Logger } from '@nestjs/common';
import { StorageNotConfiguredException } from '../storage.errors.js';
import type {
  ObjectStorageProvider,
  StorageSignedUrlInput,
  StorageUploadInput,
  StorageUploadResult,
} from './storage-provider.interface.js';

/**
 * Development-safe provider used when STORAGE_PROVIDER=none.
 * Does not pretend files were uploaded and does not write to disk permanently.
 */
@Injectable()
export class NoopStorageProvider implements ObjectStorageProvider {
  private readonly logger = new Logger(NoopStorageProvider.name);

  constructor() {
    this.logger.log(
      'Storage provider: none (object storage disabled until STORAGE_PROVIDER=r2)',
    );
  }

  isConfigured(): boolean {
    return false;
  }

  async upload(_input: StorageUploadInput): Promise<StorageUploadResult> {
    throw new StorageNotConfiguredException();
  }

  async delete(_key: string): Promise<void> {
    throw new StorageNotConfiguredException();
  }

  async exists(_key: string): Promise<boolean> {
    throw new StorageNotConfiguredException();
  }

  async getSignedUrl(_input: StorageSignedUrlInput): Promise<string> {
    throw new StorageNotConfiguredException();
  }
}
