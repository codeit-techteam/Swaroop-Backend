-- Prevent double-booking the same loading bay window (active slots only).
-- Cancelled / completed / missed / no-show slots do not block rebooking.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_slots_bay_window_active_uidx
ON vehicle_slots (warehouse_id, slot_date, loading_bay, time_slot)
WHERE status IN ('REQUESTED', 'CONFIRMED', 'ASSIGNED', 'CHECKED_IN', 'LOADING')
  AND loading_bay IS NOT NULL
  AND time_slot IS NOT NULL;

-- Prevent the same vehicle from overlapping active windows.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_slots_vehicle_window_active_uidx
ON vehicle_slots (vehicle_id, slot_date, time_slot)
WHERE status IN ('REQUESTED', 'CONFIRMED', 'ASSIGNED', 'CHECKED_IN', 'LOADING')
  AND vehicle_id IS NOT NULL
  AND time_slot IS NOT NULL;
