import { describe, expect, it } from 'vitest';
import { DocumentCategory } from '../../../generated/prisma/client.js';
import {
  buildCustomerKycKey,
  buildSellerDocumentKey,
  sanitizeFileName,
} from './document-keys.js';
import {
  ALLOWED_DOCUMENT_MIME_TYPES,
  assertFileSize,
  assertMime,
} from './document-validation.js';

describe('document-keys', () => {
  it('sanitizes unsafe filename characters', () => {
    expect(sanitizeFileName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeFileName('My File (1).PDF')).toBe('My_File_1_.PDF');
  });

  it('builds collision-safe customer and seller keys', () => {
    const docId = '11111111-1111-1111-1111-111111111111';
    const customerKey = buildCustomerKycKey('profile-a', docId, 'pan.pdf');
    expect(customerKey).toBe(
      `customers/profile-a/kyc/${docId}/${docId}-pan.pdf`,
    );

    const sellerKey = buildSellerDocumentKey(
      'seller-a',
      DocumentCategory.GST,
      docId,
      'gst cert.pdf',
    );
    expect(sellerKey).toContain('sellers/seller-a/gst/');
    expect(sellerKey).toContain(`${docId}-gst_cert.pdf`);
  });
});

describe('document-validation', () => {
  it('allows pdf/jpeg/png/webp only', () => {
    for (const mime of ALLOWED_DOCUMENT_MIME_TYPES) {
      expect(() => assertMime(mime)).not.toThrow();
    }
    expect(() => assertMime('application/zip')).toThrow();
  });

  it('enforces max file size from storage config', () => {
    expect(() => assertFileSize(100, 1024)).not.toThrow();
    expect(() => assertFileSize(2048, 1024)).toThrow();
  });
});
