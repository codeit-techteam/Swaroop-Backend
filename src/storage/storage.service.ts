import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';
import { CloudflareR2Provider } from './providers/cloudflare-r2.provider.js';
import { NoopStorageProvider } from './providers/noop-storage.provider.js';
import type {
  ObjectStorageProvider,
  StorageProviderName,
  StorageSignedUrlInput,
  StorageUploadInput,
  StorageUploadResult,
} from './providers/storage-provider.interface.js';
import { StorageNotConfiguredException } from './storage.errors.js';

/**
 * Application-facing storage abstraction.
 * Feature modules must inject StorageService only — never R2 SDK.
 */
@Injectable()
export class StorageService {
  private readonly provider: ObjectStorageProvider;
  private readonly providerName: StorageProviderName;
  private readonly maxDocumentSizeBytes: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly r2Provider: CloudflareR2Provider,
    private readonly noopProvider: NoopStorageProvider,
  ) {
    const storage = this.configService.get<AppConfig['storage']>('storage', {
      infer: true,
    });
    this.providerName = storage?.provider ?? 'none';
    this.maxDocumentSizeBytes =
      (storage?.maxDocumentSizeMb ?? 10) * 1024 * 1024;
    this.provider =
      this.providerName === 'r2' ? this.r2Provider : this.noopProvider;
  }

  getProviderName(): StorageProviderName {
    return this.providerName;
  }

  getMaxDocumentSizeBytes(): number {
    return this.maxDocumentSizeBytes;
  }

  isConfigured(): boolean {
    return this.provider.isConfigured();
  }

  /**
   * Assert storage is ready for upload/download. Throws 503 STORAGE_NOT_CONFIGURED.
   */
  assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new StorageNotConfiguredException();
    }
  }

  upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    this.assertConfigured();
    return this.provider.upload(input);
  }

  delete(key: string): Promise<void> {
    this.assertConfigured();
    return this.provider.delete(key);
  }

  getSignedUrl(input: StorageSignedUrlInput): Promise<string> {
    this.assertConfigured();
    return this.provider.getSignedUrl(input);
  }

  async exists(key: string): Promise<boolean> {
    this.assertConfigured();
    if (this.provider.exists) {
      return this.provider.exists(key);
    }
    return false;
  }

  getPublicBaseUrl(): string {
    const storage = this.configService.get<AppConfig['storage']>('storage', {
      infer: true,
    });
    return storage?.publicUrl?.replace(/\/$/, '') ?? '';
  }

  /**
   * Resolve a stored media key to a browser-loadable URL.
   * HTTPS / data URLs pass through. Object keys use the public CDN base
   * when configured, otherwise a short-lived signed GET URL.
   */
  async resolveMediaUrl(
    mediaKey?: string | null,
  ): Promise<string | null> {
    if (!mediaKey) return null;
    if (/^(https?:|data:|blob:)/i.test(mediaKey)) return mediaKey;

    const publicBase = this.getPublicBaseUrl();
    if (publicBase) {
      return `${publicBase}/${mediaKey.replace(/^\//, '')}`;
    }

    if (!this.isConfigured()) return null;

    return this.getSignedUrl({
      key: mediaKey,
      operation: 'get',
      expiresInSeconds: 3600,
    });
  }
}
