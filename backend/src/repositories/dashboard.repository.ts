import { pool } from "../config/database";
import type { AlertQuery, VehicleQuery } from "../validators/query.validator";
import type { TelemetryEvent } from "../validators/event.validator";

export type VehicleState = TelemetryEvent & { status: "OFF" | "MOVING" | "STOPPED" };
export type HistoricalAlert = TelemetryEvent & { id: string; type: "OVERSPEED"; createdAt: string };

// Timestamp text retains PostgreSQL microseconds, unlike pg's default Date parser.
const eventColumns = `event_id AS "eventId", vehicle_id AS "vehicleId",
  to_char(observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "observedAt",
  latitude, longitude, speed_kph AS "speedKph", ignition_on AS "ignitionOn"`;

export async function selectVehicles(filters: VehicleQuery): Promise<VehicleState[]> {
  const result = await pool.query<VehicleState>(
    `SELECT ${eventColumns}, status FROM vehicle_current_state
     WHERE ($1::text IS NULL OR strpos(lower(vehicle_id), lower($1)) > 0)
       AND ($2::text IS NULL OR vehicle_id = $2)
       AND ($3::text IS NULL OR status = $3)
     ORDER BY vehicle_id ASC`,
    [filters.search ?? null, filters.vehicleId ?? null, filters.status ?? null]
  );
  return result.rows;
}

export async function selectVehicleHistory(vehicleId: string): Promise<TelemetryEvent[]> {
  const result = await pool.query<TelemetryEvent>(
    `SELECT ${eventColumns} FROM telemetry_events
     WHERE vehicle_id = $1 ORDER BY observed_at ASC, event_id ASC`, [vehicleId]
  );
  return result.rows;
}

export async function selectAlerts(filters: AlertQuery): Promise<HistoricalAlert[]> {
  const result = await pool.query<HistoricalAlert>(
    `SELECT ${eventColumns}, a.id::text AS id, a.type,
       to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
     FROM telemetry_events JOIN alerts a USING (event_id, vehicle_id)
     WHERE ($1::text IS NULL OR vehicle_id = $1)
       AND ($2::text IS NULL OR a.type = $2)
     ORDER BY observed_at DESC, event_id ASC`,
    [filters.vehicleId ?? null, filters.type ?? null]
  );
  return result.rows;
}
