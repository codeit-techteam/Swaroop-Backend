import {
  EntityOwnerType,
  KycVerificationStatus,
  KycVerificationType,
  type KycVerification,
  type Prisma,
} from '../../generated/prisma/client.js';
import { hashIdentifier, panFromGstin } from './kyc-identifiers.js';
import type { KycVerificationDetails } from './kyc-verification.types.js';

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
  providerReference: string | null;
  source: string | null;
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
      if (row.failureCode === 'PAN_EVENT_MARKED' && row.failureReason) {
        return row.failureReason;
      }
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
    providerReference: row.providerReference ?? null,
    source: row.source ?? null,
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

/**
 * Hash of the PAN a GSTIN belongs to. Rows written before the provider PAN was
 * captured fall back to the GSTIN structure (characters 3–12 are the PAN).
 */
export function linkedPanHashOf(
  gst: KycVerification,
  gstin?: string | null,
): string | null {
  if (gst.linkedPanHash) return gst.linkedPanHash;
  return gstin ? hashIdentifier('PAN', panFromGstin(gstin)) : null;
}

/** True when both identifiers are accepted but the GSTIN belongs to another PAN. */
export function hasPanGstMismatch(
  pan: KycVerification | null | undefined,
  gst: KycVerification | null | undefined,
  gstin?: string | null,
): boolean {
  if (!pan || !gst) return false;
  if (!verificationSatisfied(pan) || !verificationSatisfied(gst)) return false;
  const linked = linkedPanHashOf(gst, gstin);
  return Boolean(linked) && linked !== pan.identifierHash;
}

export const PAN_GST_MISMATCH_MESSAGE =
  'GST/PAN mismatch: the PAN associated with the GSTIN does not match the entered PAN.';

/**
 * Steps still needed before PAN / GSTIN count as accepted for the identifiers
 * currently on file. An identifier edited after verification is not accepted.
 */
export function identityVerificationBlockers(
  { pan, gst }: { pan: KycVerification | null; gst: KycVerification | null },
  current: { pan?: string | null; gstin?: string | null },
): string[] {
  const blockers: string[] = [];
  const accepted = (
    row: KycVerification | null,
    kind: 'PAN' | 'GST',
    value?: string | null,
  ) =>
    verificationSatisfied(row) &&
    (!value || hashIdentifier(kind, value) === row!.identifierHash);

  const panOk = accepted(pan, 'PAN', current.pan);
  const gstOk = accepted(gst, 'GST', current.gstin);
  if (!panOk) {
    blockers.push(
      pan?.status === KycVerificationStatus.FAILED
        ? 'PAN verification (failed)'
        : 'PAN verification',
    );
  }
  if (!gstOk) {
    blockers.push(
      gst?.status === KycVerificationStatus.FAILED
        ? 'GST verification (failed)'
        : 'GST verification',
    );
  }
  if (panOk && gstOk && hasPanGstMismatch(pan, gst, current.gstin)) {
    blockers.push(PAN_GST_MISMATCH_MESSAGE);
  }
  return blockers;
}

/** Server-owned verification label written into onboarding JSON sections. */
export function verificationLabel(
  row: KycVerification | null,
  kind: 'PAN' | 'GST',
  value: unknown,
): 'verified' | 'manual_review' | 'pending' {
  if (typeof value !== 'string' || !value.trim() || !row) return 'pending';
  if (hashIdentifier(kind, value) !== row.identifierHash) return 'pending';
  if (row.status === KycVerificationStatus.VERIFIED) return 'verified';
  if (row.status === KycVerificationStatus.MANUAL_REVIEW)
    return 'manual_review';
  return 'pending';
}
