import { describe, expect, it } from 'vitest';
import {
  ACTIVE_SLOT_STATUSES,
  DEFAULT_LOADING_BAYS,
  DEFAULT_TIME_WINDOWS,
} from '../common/vehicle-slot.constants.js';

describe('vehicle-slot constants', () => {
  it('exposes standard loading bays and time windows', () => {
    expect(DEFAULT_LOADING_BAYS.length).toBeGreaterThanOrEqual(4);
    expect(DEFAULT_TIME_WINDOWS[0]?.timeSlot).toBe('09:00–10:00');
    expect(DEFAULT_TIME_WINDOWS.at(-1)?.endTime).toBe('18:00');
  });

  it('treats REQUESTED through LOADING as active (capacity-consuming)', () => {
    expect(ACTIVE_SLOT_STATUSES).toContain('REQUESTED');
    expect(ACTIVE_SLOT_STATUSES).toContain('LOADING');
    expect(ACTIVE_SLOT_STATUSES).not.toContain('CANCELLED');
    expect(ACTIVE_SLOT_STATUSES).not.toContain('COMPLETED');
  });
});
