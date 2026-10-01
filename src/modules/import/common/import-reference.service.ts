import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import {
  REFERENCE_PREFIX,
  REFERENCE_SEQUENCE,
  type ReferenceKind,
} from '../domain/import.constants.js';

type SqlClient = Pick<PrismaService, '$queryRaw'>;

export function formatReference(
  kind: ReferenceKind,
  value: bigint | number,
  at: Date,
): string {
  const yyyymm = `${at.getUTCFullYear()}${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${REFERENCE_PREFIX[kind]}-${yyyymm}-${String(value).padStart(6, '0')}`;
}

/**
 * Reference numbers come from Postgres sequences, so concurrent requests can
 * never collide (IBR-202610-000001, ISO-..., INE-..., IDL-...).
 */
@Injectable()
export class ImportReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  async next(
    kind: ReferenceKind,
    client: SqlClient = this.prisma,
  ): Promise<string> {
    const sequence = Prisma.raw(`"${REFERENCE_SEQUENCE[kind]}"`);
    const rows = await client.$queryRaw<
      Array<{ n: bigint }>
    >`SELECT nextval('${sequence}') AS n`;
    return formatReference(kind, rows[0].n, new Date());
  }
}
