export type StorageUploadInput = {
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  metadata?: Record<string, string>;
};

export type StorageUploadResult = {
  key: string;
  bucket: string;
  etag?: string;
  url?: string;
};

export type StorageSignedUrlInput = {
  key: string;
  expiresInSeconds?: number;
  operation?: 'get' | 'put';
  contentType?: string;
};

export type StorageProviderName = 'none' | 'r2';

/**
 * Storage provider contract.
 * Domain modules depend on StorageService, never on Cloudflare R2 SDK.
 */
export interface ObjectStorageProvider {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  delete(key: string): Promise<void>;
  getSignedUrl(input: StorageSignedUrlInput): Promise<string>;
  exists?(key: string): Promise<boolean>;
  isConfigured(): boolean;
}
