import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
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
    const client = this.requireClient();
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: this.bucketName,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
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
