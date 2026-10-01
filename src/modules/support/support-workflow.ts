import {
  SupportRequesterType,
  SupportTicketChannel,
  SupportTicketStatus,
} from '../../generated/prisma/client.js';

const S = SupportTicketStatus;

/** Statuses an agent may move a ticket to, keyed by the current status. */
const AGENT_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  [S.OPEN]: [S.IN_PROGRESS, S.WAITING_CUSTOMER, S.RESOLVED, S.CLOSED],
  [S.IN_PROGRESS]: [S.WAITING_CUSTOMER, S.RESOLVED, S.CLOSED],
  [S.WAITING_CUSTOMER]: [S.IN_PROGRESS, S.RESOLVED, S.CLOSED],
  [S.RESOLVED]: [S.IN_PROGRESS, S.CLOSED],
  [S.CLOSED]: [S.IN_PROGRESS],
};

export const RESOLUTION_NOTE_MIN_LENGTH = 5;
export const TICKETS_PER_HOUR_LIMIT = 10;

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function isTerminal(status: SupportTicketStatus) {
  return status === S.RESOLVED || status === S.CLOSED;
}

export function allowedAgentTransitions(
  from: SupportTicketStatus,
): SupportTicketStatus[] {
  return AGENT_TRANSITIONS[from];
}

export function checkAgentTransition(
  from: SupportTicketStatus,
  to: SupportTicketStatus,
  note?: string | null,
): TransitionCheck {
  const trimmed = note?.trim() ?? '';
  if (from === to) {
    return trimmed
      ? { ok: true }
      : { ok: false, reason: `Ticket is already ${label(to)}.` };
  }
  if (!AGENT_TRANSITIONS[from].includes(to)) {
    return {
      ok: false,
      reason: `Cannot move a ticket from ${label(from)} to ${label(to)}.`,
    };
  }
  if (to === S.RESOLVED && trimmed.length < RESOLUTION_NOTE_MIN_LENGTH) {
    return {
      ok: false,
      reason: 'Add a resolution note so the requester knows what was done.',
    };
  }
  return { ok: true };
}

/** Status after the requester replies. CLOSED tickets cannot be replied to. */
export function statusAfterRequesterReply(
  from: SupportTicketStatus,
): SupportTicketStatus | null {
  switch (from) {
    case S.CLOSED:
      return null;
    case S.RESOLVED:
    case S.WAITING_CUSTOMER:
      return S.IN_PROGRESS;
    default:
      return from;
  }
}

/** Status after an agent replies. CLOSED tickets must be reopened first. */
export function statusAfterAgentReply(
  from: SupportTicketStatus,
): SupportTicketStatus | null {
  switch (from) {
    case S.CLOSED:
      return null;
    case S.OPEN:
      return S.IN_PROGRESS;
    case S.RESOLVED:
      return S.RESOLVED;
    default:
      return S.WAITING_CUSTOMER;
  }
}

export function sourceLabel(
  requesterType: SupportRequesterType,
  channel: SupportTicketChannel,
) {
  const who =
    requesterType === SupportRequesterType.SELLER ? 'Seller' : 'Customer';
  const where = channel === SupportTicketChannel.APP ? 'App' : 'Web';
  return `${who} ${where}` as
    'Customer Web' | 'Customer App' | 'Seller Web' | 'Seller App';
}

export function label(status: SupportTicketStatus) {
  return status === S.WAITING_CUSTOMER
    ? 'waiting on requester'
    : status.replace(/_/g, ' ').toLowerCase();
}
