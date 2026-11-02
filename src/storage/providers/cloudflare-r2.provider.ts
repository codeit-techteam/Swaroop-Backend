import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';
import { StorageNotConfiguredException } from '../storage.errors.js';
import type {
  ObjectStorageProvider,
  StorageListObjectsInput,
  StorageListObjectsResult,
  StorageObjectMeta,
  StorageSignedUrlInput,
  StorageUploadInput,
  StorageUploadResult,
} from './storage-provider.interface.js';

@Injectable()
export class CloudflareR2Provider implements ObjectStorageProvider {
  private readonly logger = new Logger(CloudflareR2Provider.name);
  private readonly client: S3Client | null;
  private readonly bucketName: string;
  private readonly publicUrl: string;
  private readonly configured: boolean;

  constructor(private readonly configService: ConfigService) {
    const storage = this.configService.get<AppConfig['storage']>('storage', {
      infer: true,
    });

    this.bucketName = storage?.bucketName ?? '';
    this.publicUrl = storage?.publicUrl ?? '';

    this.configured = Boolean(
      storage?.accountId &&
      storage.accessKeyId &&
      storage.secretAccessKey &&
      storage.bucketName &&
      storage.endpoint,
    );

    if (!this.configured) {
      this.logger.warn(
        'Cloudflare R2 provider selected but credentials are incomplete. Storage operations will return STORAGE_NOT_CONFIGURED until R2 is configured.',
      );
      this.client = null;
      return;
    }

    this.client = new S3Client({
      region: storage?.region || 'auto',
      endpoint: storage!.endpoint,
      // R2 does not support virtual-hosted-style DNS for all buckets.
      forcePathStyle: true,
      credentials: {
        accessKeyId: storage!.accessKeyId,
        secretAccessKey: storage!.secretAccessKey,
      },
    });
    this.logger.log('Cloudflare R2 storage provider initialized');
  }

  isConfigured(): boolean {
    return this.configured && this.client !== null;
  }

  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    const client = this.requireClient();

    const result = await client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        Metadata: input.metadata,
      }),
    );

    return {
      key: input.key,
      bucket: this.bucketName,
      etag: result.ETag,
      url: this.publicUrl
        ? `${this.publicUrl.replace(/\/$/, '')}/${input.key}`
        : undefined,
    };
  }

  async delete(key: string): Promise<void> {
    const client = this.requireClient();
    await client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }

  async exists(key: string): Promise<boolean> {
    const meta = await this.headObject(key);
    return meta != null;
  }

  async listObjects(
    input: StorageListObjectsInput,
  ): Promise<StorageListObjectsResult> {
    const client = this.requireClient();
    const result = await client.send(
      new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: input.prefix,
        ContinuationToken: input.continuationToken,
        MaxKeys: Math.min(Math.max(input.maxKeys ?? 500, 1), 1000),
      }),
    );
    return {
      objects: (result.Contents ?? [])
        .filter((item): item is typeof item & { Key: string } => Boolean(item.Key))
        .map((item) => ({
          key: item.Key,
          size: item.Size,
          lastModified: item.LastModified,
        })),
      continuationToken: result.IsTruncated
        ? result.NextContinuationToken
        : undefined,
      isTruncated: Boolean(result.IsTruncated),
    };
  }

  async headObject(key: string): Promise<StorageObjectMeta | null> {
    const client = this.requireClient();
    try {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      const metadata: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.Metadata ?? {})) {
        if (v != null) metadata[k.toLowerCase()] = String(v);
      }
      return {
        key,
        size: result.ContentLength,
        contentType: result.ContentType,
        etag: result.ETag,
        metadata,
      };
    } catch {
      return null;
    }
  }

  async getSignedUrl(input: StorageSignedUrlInput): Promise<string> {
    const client = this.requireClient();
    const expiresIn =
      input.expiresInSeconds ??
      this.configService.get<AppConfig['storage']>('storage', { infer: true })
        ?.signedUrlExpirySeconds ??
      900;
    const operation = input.operation ?? 'get';

    const command =
      operation === 'put'
        ? new PutObjectCommand({
            Bucket: this.bucketName,
            Key: input.key,
            ContentType: input.contentType,
          })
        : new GetObjectCommand({
            Bucket: this.bucketName,
            Key: input.key,
            ResponseContentDisposition: input.responseContentDisposition,
            ResponseContentType: input.responseContentType,
          });

    return getSignedUrl(client, command, { expiresIn });
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new StorageNotConfiguredException(
        'Cloudflare R2 is not configured. Set STORAGE_PROVIDER=r2 and R2 credentials.',
      );
    }
    return this.client;
  }
}
