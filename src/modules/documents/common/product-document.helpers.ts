import { DocumentCategory } from '../../../generated/prisma/client.js';

/** Categories allowed on seller product / offer technical documents. */
export const PRODUCT_DOCUMENT_CATEGORIES = [
  DocumentCategory.TDS,
  DocumentCategory.MSDS,
  DocumentCategory.SDS,
  DocumentCategory.COA,
  DocumentCategory.TECHNICAL_SPECIFICATION,
  DocumentCategory.PRODUCT_SPECIFICATION,
  DocumentCategory.QUALITY_CERTIFICATE,
  DocumentCategory.TEST_CERTIFICATE,
  DocumentCategory.COMPLIANCE_CERTIFICATE,
  DocumentCategory.PRODUCT_TDS,
  DocumentCategory.ISO,
  DocumentCategory.OTHER,
] as const;

export type ProductDocumentCategory =
  (typeof PRODUCT_DOCUMENT_CATEGORIES)[number];

/** MDS is an alias used in seller UX; map to MSDS in Prisma. */
export const PRODUCT_DOCUMENT_CATEGORY_ALIASES: Record<string, DocumentCategory> =
  {
    MDS: DocumentCategory.MSDS,
  };

export const PRODUCT_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

export const CUSTOMER_VISIBLE_DOCUMENT_STATUSES = new Set([
  'VERIFIED',
  'UPLOADED',
]);

export function isProductDocumentCategory(
  category: DocumentCategory | string,
): boolean {
  const normalized =
    PRODUCT_DOCUMENT_CATEGORY_ALIASES[String(category).toUpperCase()] ??
    category;
  return (PRODUCT_DOCUMENT_CATEGORIES as readonly string[]).includes(
    String(normalized),
  );
}

export function resolveProductDocumentCategory(
  category: string,
): DocumentCategory {
  const upper = category.toUpperCase();
  if (PRODUCT_DOCUMENT_CATEGORY_ALIASES[upper]) {
    return PRODUCT_DOCUMENT_CATEGORY_ALIASES[upper];
  }
  return upper as DocumentCategory;
}

/** Customer-facing title — never uses seller-identifying original filename. */
export function customerDocumentTitle(
  category: DocumentCategory | string,
  metadataTitle?: string | null,
): string {
  if (metadataTitle?.trim()) return metadataTitle.trim();
  const map: Record<string, string> = {
    TDS: 'Technical Data Sheet',
    PRODUCT_TDS: 'Technical Data Sheet',
    MSDS: 'Material Safety Data Sheet',
    SDS: 'Safety Data Sheet',
    COA: 'Certificate of Analysis',
    TECHNICAL_SPECIFICATION: 'Technical Specification',
    PRODUCT_SPECIFICATION: 'Product Specification',
    QUALITY_CERTIFICATE: 'Quality Certificate',
    TEST_CERTIFICATE: 'Test Certificate',
    COMPLIANCE_CERTIFICATE: 'Compliance Certificate',
    ISO: 'ISO Certificate',
    OTHER: 'Product Technical Document',
  };
  return map[String(category)] ?? 'Verified Product Document';
}

/** Sanitized download filename for customers (no seller identity). */
export function customerSafeFileName(
  category: DocumentCategory | string,
  version: number,
  mimeType?: string | null,
): string {
  const ext = mimeType?.includes('pdf')
    ? 'pdf'
    : mimeType?.includes('jpeg') || mimeType?.includes('jpg')
      ? 'jpg'
      : mimeType?.includes('png')
        ? 'png'
        : mimeType?.includes('sheet') || mimeType?.includes('excel')
          ? 'xlsx'
          : mimeType?.includes('word')
            ? 'docx'
            : 'pdf';
  const slug = String(category)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
  return `Product_${slug}_v${version}.${ext}`;
}

export function customerDocumentStatusLabel(
  status: string,
): 'APPROVED' | 'PENDING_REVIEW' | 'REJECTED' | 'ARCHIVED' | 'UPLOADED' {
  if (status === 'VERIFIED') return 'APPROVED';
  if (status === 'UNDER_REVIEW') return 'PENDING_REVIEW';
  if (status === 'REJECTED') return 'REJECTED';
  if (status === 'ARCHIVED' || status === 'REPLACED' || status === 'EXPIRED') {
    return 'ARCHIVED';
  }
  return 'UPLOADED';
}
