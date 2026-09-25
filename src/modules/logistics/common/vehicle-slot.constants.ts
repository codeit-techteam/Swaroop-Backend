/** Default loading bay labels when warehouse.metadata.loadingBays is unset. */
export const DEFAULT_LOADING_BAYS = [
  'Bay 01',
  'Bay 02',
  'Bay 03',
  'Bay 04',
  'Bay 05',
  'Bay 06',
  'Bay 07',
  'Bay 08',
] as const;

/** Standard one-hour loading windows (IST business day). */
export const DEFAULT_TIME_WINDOWS = [
  { timeSlot: '09:00–10:00', startTime: '09:00', endTime: '10:00' },
  { timeSlot: '10:00–11:00', startTime: '10:00', endTime: '11:00' },
  { timeSlot: '11:00–12:00', startTime: '11:00', endTime: '12:00' },
  { timeSlot: '12:00–13:00', startTime: '12:00', endTime: '13:00' },
  { timeSlot: '13:00–14:00', startTime: '13:00', endTime: '14:00' },
  { timeSlot: '14:00–15:00', startTime: '14:00', endTime: '15:00' },
  { timeSlot: '15:00–16:00', startTime: '15:00', endTime: '16:00' },
  { timeSlot: '16:00–17:00', startTime: '16:00', endTime: '17:00' },
  { timeSlot: '17:00–18:00', startTime: '17:00', endTime: '18:00' },
] as const;

export const ACTIVE_SLOT_STATUSES = [
  'REQUESTED',
  'CONFIRMED',
  'ASSIGNED',
  'CHECKED_IN',
  'LOADING',
] as const;
