import { BadRequestException } from '@nestjs/common';

export const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedDocumentMimeType =
  (typeof ALLOWED_DOCUMENT_MIME_TYPES)[number];

export function assertMime(mimeType: string): asserts mimeType is string {
  if (!(ALLOWED_DOCUMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new BadRequestException(
      `Unsupported mime type. Allowed: ${ALLOWED_DOCUMENT_MIME_TYPES.join(', ')}`,
    );
  }
}

export function assertFileSize(fileSizeBytes: number, maxBytes: number): void {
  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes < 1) {
    throw new BadRequestException('fileSizeBytes must be a positive integer');
  }
  if (fileSizeBytes > maxBytes) {
    const maxMb = Math.round(maxBytes / (1024 * 1024));
    throw new BadRequestException(
      `File exceeds maximum allowed size of ${maxMb}MB`,
    );
  }
}
