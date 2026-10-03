import {
  EntityOwnerType,
  KycVerificationStatus,
  KycVerificationType,
  type KycVerification,
  type Prisma,
} from '../../../../generated/prisma/client.js';
import type { KycVerificationDetails } from './kyc-verification.provider.js';

type VerificationReader = {
  kycVerification: {
    findFirst(
      args: Prisma.KycVerificationFindFirstArgs,
    ): Promise<KycVerification | null>;
  };
};

export type KycVerificationView = {
  id: string;
  type: KycVerificationType;
  status: KycVerificationStatus;
  /** PROVIDER when the external API confirmed it, MANUAL when compliance did. */
  method: 'PROVIDER' | 'MANUAL' | null;
  identifierMasked: string;
  provider: string;
  details: KycVerificationDetails;
  failureCode: string | null;
  message: string;
  verifiedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

const MANUAL_REVIEW_MESSAGES: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED:
    'Saved. The PetroTrade compliance team will verify it during review.',
  ABANDONED: 'Verification was interrupted. Please verify again.',
};

function messageFor(row: KycVerification): string {
  const label = row.type === KycVerificationType.PAN ? 'PAN' : 'GSTIN';
  switch (row.status) {
    case KycVerificationStatus.VERIFIED:
      return row.reviewedById
        ? `${label} verified by the PetroTrade compliance team.`
        : `${label} verified.`;
    case KycVerificationStatus.VERIFYING:
      return `Verifying ${label}…`;
    case KycVerificationStatus.FAILED:
      return row.failureReason ?? `${label} verification failed.`;
    case KycVerificationStatus.MANUAL_REVIEW:
      return (
        MANUAL_REVIEW_MESSAGES[row.failureCode ?? ''] ??
        "We couldn't reach the verification service. You can retry, or continue and the compliance team will verify it manually."
      );
  }
}

export function toVerificationView(row: KycVerification): KycVerificationView {
  const details =
    row.result && typeof row.result === 'object' && !Array.isArray(row.result)
      ? (row.result as KycVerificationDetails)
      : {};
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    method:
      row.status !== KycVerificationStatus.VERIFIED
        ? null
        : row.reviewedById
          ? 'MANUAL'
          : 'PROVIDER',
    identifierMasked: row.identifierMasked,
    provider: row.provider,
    details,
    failureCode: row.failureCode,
    message: messageFor(row),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** VERIFIED, or waiting on compliance because the provider could not decide. */
export function verificationSatisfied(
  row: KycVerification | null | undefined,
): boolean {
  return (
    row?.status === KycVerificationStatus.VERIFIED ||
    row?.status === KycVerificationStatus.MANUAL_REVIEW
  );
}

export async function latestVerification(
  db: VerificationReader,
  ownerType: EntityOwnerType,
  ownerId: string,
  type: KycVerificationType,
): Promise<KycVerification | null> {
  return db.kycVerification.findFirst({
    where: { ownerType, ownerId, type },
    orderBy: { createdAt: 'desc' },
  });
}

export async function latestVerifications(
  db: VerificationReader,
  ownerType: EntityOwnerType,
  ownerId: string,
) {
  const [pan, gst] = await Promise.all([
    latestVerification(db, ownerType, ownerId, KycVerificationType.PAN),
    latestVerification(db, ownerType, ownerId, KycVerificationType.GST),
  ]);
  return { pan, gst };
}
