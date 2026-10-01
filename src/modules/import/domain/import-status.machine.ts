import { ImportListingStatus as S } from '../../../generated/prisma/client.js';
import { ImportException } from './import.errors.js';

const TRANSITIONS: Record<S, readonly S[]> = {
  [S.DRAFT]: [S.PUBLISHED, S.CANCELLED],
  [S.PUBLISHED]: [
    S.MATCHING,
    S.OFFER_RECEIVED,
    S.NEGOTIATION,
    S.MATCHED,
    S.PAUSED,
    S.EXPIRED,
    S.CANCELLED,
  ],
  [S.MATCHING]: [
    S.OFFER_RECEIVED,
    S.NEGOTIATION,
    S.MATCHED,
    S.PAUSED,
    S.EXPIRED,
    S.CANCELLED,
  ],
  [S.OFFER_RECEIVED]: [
    S.NEGOTIATION,
    S.MATCHED,
    S.PAUSED,
    S.EXPIRED,
    S.CANCELLED,
  ],
  [S.NEGOTIATION]: [S.MATCHED, S.PAUSED, S.EXPIRED, S.CANCELLED],
  // A deal that is cancelled before confirmation sends the listing back to negotiation.
  [S.MATCHED]: [S.DEAL_CONFIRMED, S.NEGOTIATION, S.CANCELLED],
  [S.DEAL_CONFIRMED]: [S.PARTIALLY_FULFILLED, S.FULFILLED, S.CANCELLED],
  [S.PARTIALLY_FULFILLED]: [S.FULFILLED, S.CANCELLED],
  [S.FULFILLED]: [],
  [S.PAUSED]: [S.PUBLISHED, S.EXPIRED, S.CANCELLED],
  [S.EXPIRED]: [],
  [S.CANCELLED]: [],
};

/** Forward progress of a live listing; used for automatic status bumps. */
const PROGRESS_RANK: Partial<Record<S, number>> = {
  [S.PUBLISHED]: 1,
  [S.MATCHING]: 2,
  [S.OFFER_RECEIVED]: 3,
  [S.NEGOTIATION]: 4,
  [S.MATCHED]: 5,
  [S.DEAL_CONFIRMED]: 6,
  [S.PARTIALLY_FULFILLED]: 7,
  [S.FULFILLED]: 8,
};

export function canTransition(from: S, to: S): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: S, to: S): void {
  if (!canTransition(from, to)) {
    throw new ImportException(
      from === S.EXPIRED
        ? 'IMPORT_ALREADY_EXPIRED'
        : 'IMPORT_INVALID_STATUS_TRANSITION',
      `Cannot move from ${from} to ${to}.`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
}

/**
 * Returns `target` only when it is further along the progression and the move
 * is allowed; otherwise keeps `current`. Never moves a listing backwards.
 */
export function advanceStatus(current: S, target: S): S {
  const from = PROGRESS_RANK[current];
  const to = PROGRESS_RANK[target];
  if (from === undefined || to === undefined || to <= from) return current;
  return canTransition(current, target) ? target : current;
}

export function allowedTransitions(from: S): readonly S[] {
  return TRANSITIONS[from];
}

export function isTerminal(status: S): boolean {
  return TRANSITIONS[status].length === 0;
}
