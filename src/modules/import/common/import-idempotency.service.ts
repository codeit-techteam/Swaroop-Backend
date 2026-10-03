import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { ImportException } from '../domain/import.errors.js';

export type IdempotencyScope =
  | 'LISTING_PUBLISH'
  | 'NEGOTIATION_OPEN'
  | 'NEGOTIATION_COUNTER'
  | 'NEGOTIATION_ACCEPT'
  | 'DEAL_CONFIRM'
  | 'SHIPMENT_CREATE';

type TxClient = Prisma.TransactionClient;

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;

/**
 * Client retries with the same `Idempotency-Key` header replay the original
 * result instead of performing the action twice. The record is written inside
 * the action's own transaction, so a key is only consumed by a committed write.
 */
@Injectable()
export class ImportIdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  normalise(key: string | undefined | null): string | null {
    if (key === undefined || key === null || key.trim() === '') return null;
    const trimmed = key.trim();
    if (!KEY_PATTERN.test(trimmed)) {
      throw new ImportException(
        'IMPORT_VALIDATION_FAILED',
        'Idempotency-Key must be 8-128 characters of letters, digits, "-", "_", ":" or ".".',
      );
    }
    return trimmed;
  }

  /** Returns the resourceId recorded for an earlier identical request, if any. */
  async replay(
    actorUserId: string,
    scope: IdempotencyScope,
    key: string | null,
  ) {
    if (!key) return null;
    const existing = await this.prisma.importIdempotencyRecord.findUnique({
      where: { actorUserId_scope_key: { actorUserId, scope, key } },
      select: { resourceId: true },
    });
    return existing?.resourceId ?? null;
  }

  async record(
    tx: TxClient,
    actorUserId: string,
    scope: IdempotencyScope,
    key: string | null,
    resourceId: string,
  ) {
    if (!key) return;
    try {
      await tx.importIdempotencyRecord.create({
        data: { actorUserId, scope, key, resourceId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ImportException('DUPLICATE_REQUEST');
      }
      throw error;
    }
  }
}
