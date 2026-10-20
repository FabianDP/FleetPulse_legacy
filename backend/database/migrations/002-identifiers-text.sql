-- Apply once to existing installations during a maintenance window.
-- Preserves data and constraints; ALTER TABLE requires table locks.
BEGIN;
ALTER TABLE telemetry_events
    ALTER COLUMN event_id TYPE TEXT,
    ALTER COLUMN vehicle_id TYPE TEXT;
ALTER TABLE vehicle_current_state
    ALTER COLUMN event_id TYPE TEXT,
    ALTER COLUMN vehicle_id TYPE TEXT;
ALTER TABLE alerts
    ALTER COLUMN event_id TYPE TEXT,
    ALTER COLUMN vehicle_id TYPE TEXT;
COMMIT;
