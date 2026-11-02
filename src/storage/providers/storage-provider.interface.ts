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
  /** GET only: overrides the Content-Disposition header R2 returns. */
  responseContentDisposition?: string;
  /** GET only: overrides the Content-Type header R2 returns. */
  responseContentType?: string;
};

export type StorageProviderName = 'none' | 'r2';

export type StorageListedObject = {
  key: string;
  size?: number;
  lastModified?: Date;
};

export type StorageListObjectsInput = {
  prefix: string;
  continuationToken?: string;
  maxKeys?: number;
};

export type StorageListObjectsResult = {
  objects: StorageListedObject[];
  continuationToken?: string;
  isTruncated: boolean;
};

export type StorageObjectMeta = {
  key: string;
  size?: number;
  contentType?: string;
  etag?: string;
  /** Provider metadata keys are lowercased (S3/R2 convention). */
  metadata: Record<string, string>;
};

/**
 * Storage provider contract.
 * Domain modules depend on StorageService, never on Cloudflare R2 SDK.
 */
export interface ObjectStorageProvider {
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  delete(key: string): Promise<void>;
  getSignedUrl(input: StorageSignedUrlInput): Promise<string>;
  exists?(key: string): Promise<boolean>;
  listObjects?(
    input: StorageListObjectsInput,
  ): Promise<StorageListObjectsResult>;
  headObject?(key: string): Promise<StorageObjectMeta | null>;
  isConfigured(): boolean;
}
