import { describe, expect, it } from 'vitest';
import {
  SupportRequesterType,
  SupportTicketChannel,
  SupportTicketStatus as S,
} from '../../generated/prisma/client.js';
import {
  checkAgentTransition,
  sourceLabel,
  statusAfterAgentReply,
  statusAfterRequesterReply,
} from './support-workflow.js';

describe('checkAgentTransition', () => {
  it('requires a resolution note to resolve', () => {
    expect(checkAgentTransition(S.IN_PROGRESS, S.RESOLVED).ok).toBe(false);
    expect(checkAgentTransition(S.IN_PROGRESS, S.RESOLVED, '  ok ').ok).toBe(
      false,
    );
    expect(
      checkAgentTransition(S.IN_PROGRESS, S.RESOLVED, 'Refund issued to bank')
        .ok,
    ).toBe(true);
  });

  it('allows reopening resolved and closed tickets', () => {
    expect(checkAgentTransition(S.RESOLVED, S.IN_PROGRESS).ok).toBe(true);
    expect(checkAgentTransition(S.CLOSED, S.IN_PROGRESS).ok).toBe(true);
  });

  it('rejects moves that skip the workflow', () => {
    expect(checkAgentTransition(S.CLOSED, S.RESOLVED, 'Fixed it').ok).toBe(
      false,
    );
    expect(checkAgentTransition(S.RESOLVED, S.WAITING_CUSTOMER).ok).toBe(false);
    expect(checkAgentTransition(S.IN_PROGRESS, S.OPEN).ok).toBe(false);
  });

  it('treats a same-status update as a note only when a note is given', () => {
    expect(checkAgentTransition(S.IN_PROGRESS, S.IN_PROGRESS).ok).toBe(false);
    expect(
      checkAgentTransition(S.IN_PROGRESS, S.IN_PROGRESS, 'Still checking').ok,
    ).toBe(true);
  });
});

describe('reply status effects', () => {
  it('requester reply reopens resolved tickets and blocks closed ones', () => {
    expect(statusAfterRequesterReply(S.RESOLVED)).toBe(S.IN_PROGRESS);
    expect(statusAfterRequesterReply(S.WAITING_CUSTOMER)).toBe(S.IN_PROGRESS);
    expect(statusAfterRequesterReply(S.OPEN)).toBe(S.OPEN);
    expect(statusAfterRequesterReply(S.CLOSED)).toBeNull();
  });

  it('agent reply picks up open tickets and waits on the requester otherwise', () => {
    expect(statusAfterAgentReply(S.OPEN)).toBe(S.IN_PROGRESS);
    expect(statusAfterAgentReply(S.IN_PROGRESS)).toBe(S.WAITING_CUSTOMER);
    expect(statusAfterAgentReply(S.RESOLVED)).toBe(S.RESOLVED);
    expect(statusAfterAgentReply(S.CLOSED)).toBeNull();
  });
});

describe('sourceLabel', () => {
  it('combines requester type and channel', () => {
    expect(
      sourceLabel(SupportRequesterType.CUSTOMER, SupportTicketChannel.APP),
    ).toBe('Customer App');
    expect(
      sourceLabel(SupportRequesterType.SELLER, SupportTicketChannel.WEB),
    ).toBe('Seller Web');
  });
});
