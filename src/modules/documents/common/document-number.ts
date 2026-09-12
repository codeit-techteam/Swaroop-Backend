import { Prisma } from '../../../generated/prisma/client.js';

type TxLike = {
  document: {
    create: (args: unknown) => Promise<unknown>;
    findUnique: (args: unknown) => Promise<{ id: string } | null>;
  };
};

/** Format: DOC-YYYY-###### */
export function formatDocumentNumber(now = new Date()): string {
  const year = now.getFullYear();
  const seq = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `DOC-${year}-${seq}`;
}

export async function generateUniqueDocumentNumber(
  tx: {
    document: {
      findUnique: (args: {
        where: { documentNumber: string };
        select: { id: true };
      }) => Promise<{ id: string } | null>;
    };
  },
  maxAttempts = 12,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = formatDocumentNumber();
    const existing = await tx.document.findUnique({
      where: { documentNumber: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  throw new Error('Failed to allocate unique documentNumber');
}

export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/** @internal unused helper kept for typing clarity in retries */
export type DocumentNumberTx = TxLike;
