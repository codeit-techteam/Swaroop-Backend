import type { Prisma } from '../../../generated/prisma/client.js';
import { readCustomerKycState } from './customer-kyc.slots.js';

/**
 * Locks the customer profile row for the rest of the transaction and returns
 * its current metadata, so concurrent submit / approve / reject calls apply
 * one after another against fresh KYC state instead of a stale read.
 */
export async function lockCustomerKyc(
  tx: Prisma.TransactionClient,
  customerProfileId: string,
) {
  const rows = await tx.$queryRaw<Array<{ metadata: unknown }>>`
    SELECT metadata FROM customer_profiles
    WHERE id = ${customerProfileId}::uuid
    FOR UPDATE
  `;
  const metadata = rows[0]?.metadata ?? null;
  return { metadata, kyc: readCustomerKycState(metadata) };
}
