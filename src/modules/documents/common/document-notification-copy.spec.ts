import { DocumentCategory } from '../../../generated/prisma/client.js';
import { CUSTOMER_KYC_DOCUMENT_PURPOSE } from '../../customers/kyc/customer-kyc.slots.js';
import {
  documentApprovedNotificationBody,
  documentRejectedNotificationBody,
  humanDocumentNotificationLabel,
  looksLikeRawUploadName,
} from './document-notification-copy.js';

describe('document-notification-copy', () => {
  it('detects raw upload filenames', () => {
    expect(
      looksLikeRawUploadName('WhatsApp Image 2026-09-09 at 4.30.22 PM.jpeg'),
    ).toBe(true);
    expect(looksLikeRawUploadName('qr_sumit.png')).toBe(true);
    expect(looksLikeRawUploadName('GST Certificate')).toBe(false);
  });

  it('prefers KYC slot labels over raw filenames', () => {
    expect(
      humanDocumentNotificationLabel({
        category: DocumentCategory.GST,
        originalFileName: 'WhatsApp Image 2026-09-09 at 4.30.22 PM.jpeg',
        fileName: 'qr_sumit.png',
        metadata: { purpose: CUSTOMER_KYC_DOCUMENT_PURPOSE, slot: 'gst' },
      }),
    ).toBe('GST Certificate');
  });

  it('falls back to category labels when slot is missing', () => {
    expect(
      humanDocumentNotificationLabel({
        category: DocumentCategory.PAN,
        originalFileName: 'scan.pdf',
        metadata: {},
      }),
    ).toBe('PAN card');
  });

  it('builds plain approve/reject bodies', () => {
    expect(documentApprovedNotificationBody('GST Certificate')).toBe(
      'Your GST Certificate was verified.',
    );
    expect(documentApprovedNotificationBody('document')).toBe(
      'Your document was verified.',
    );
    expect(
      documentRejectedNotificationBody('PAN card', 'Image is blurry'),
    ).toBe('Your PAN card was rejected: Image is blurry. Please upload a replacement.');
  });
});
