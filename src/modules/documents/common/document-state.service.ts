import { BadRequestException, Injectable } from '@nestjs/common';
import { DocumentStatus } from '../../../generated/prisma/client.js';

const ALLOWED: Record<DocumentStatus, DocumentStatus[]> = {
  [DocumentStatus.UPLOADED]: [
    DocumentStatus.UNDER_REVIEW,
    DocumentStatus.VERIFIED,
    DocumentStatus.REJECTED,
    DocumentStatus.ARCHIVED,
  ],
  [DocumentStatus.UNDER_REVIEW]: [
    DocumentStatus.VERIFIED,
    DocumentStatus.REJECTED,
    DocumentStatus.ARCHIVED,
    DocumentStatus.UNDER_REVIEW,
  ],
  [DocumentStatus.VERIFIED]: [
    DocumentStatus.EXPIRED,
    DocumentStatus.REPLACED,
    DocumentStatus.UNDER_REVIEW,
    DocumentStatus.ARCHIVED,
  ],
  [DocumentStatus.REJECTED]: [
    DocumentStatus.REPLACED,
    DocumentStatus.ARCHIVED,
    DocumentStatus.UNDER_REVIEW,
  ],
  [DocumentStatus.EXPIRED]: [
    DocumentStatus.ARCHIVED,
    DocumentStatus.REPLACED,
    DocumentStatus.UNDER_REVIEW,
  ],
  [DocumentStatus.REPLACED]: [DocumentStatus.ARCHIVED],
  [DocumentStatus.ARCHIVED]: [],
};

@Injectable()
export class DocumentStateService {
  assertTransition(from: DocumentStatus, to: DocumentStatus): void {
    if (from === to) return;
    const allowed = ALLOWED[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid document status transition from ${from} to ${to}`,
      );
    }
  }

  /** API "approve" maps to VERIFIED. */
  approveTarget(): DocumentStatus {
    return DocumentStatus.VERIFIED;
  }

  /** Response helper: VERIFIED is exposed with approved:true (APPROVED alias). */
  toApiStatus(status: DocumentStatus): {
    status: DocumentStatus;
    approved: boolean;
  } {
    return {
      status,
      approved: status === DocumentStatus.VERIFIED,
    };
  }
}
