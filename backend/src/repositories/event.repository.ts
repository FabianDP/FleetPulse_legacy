import type { PoolClient } from "pg";
import type { TelemetryEvent } from "../validators/event.validator";

export async function findEventById(
  client: PoolClient,
  eventId: string,
  observedAt: string
) {
  const result = await client.query<Omit<TelemetryEvent, "observedAt"> & { sameObservedAt: boolean }>(
    `SELECT
       event_id AS "eventId",
       vehicle_id AS "vehicleId",
       observed_at = $2::timestamptz AS "sameObservedAt",
       latitude,
       longitude,
       speed_kph AS "speedKph",
       ignition_on AS "ignitionOn"
     FROM telemetry_events
     WHERE event_id = $1`,
    [eventId, observedAt]
  );

  return result.rows[0];
}

export async function insertEvent(
  client: PoolClient,
  event: TelemetryEvent
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO telemetry_events (
       event_id, vehicle_id, observed_at,
       latitude, longitude, speed_kph, ignition_on
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [
      event.eventId,
      event.vehicleId,
      event.observedAt,
      event.latitude,
      event.longitude,
      event.speedKph,
      event.ignitionOn
    ]
  );

  return result.rowCount === 1;
}

export async function updateVehicleState(
  client: PoolClient,
  event: TelemetryEvent
): Promise<boolean> {
  const status = !event.ignitionOn
    ? "OFF"
    : event.speedKph > 0
      ? "MOVING"
      : "STOPPED";

  const result = await client.query(
    `INSERT INTO vehicle_current_state (
       vehicle_id, event_id, observed_at,
       latitude, longitude, speed_kph,
       ignition_on, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (vehicle_id) DO UPDATE SET
       event_id = EXCLUDED.event_id,
       observed_at = EXCLUDED.observed_at,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       speed_kph = EXCLUDED.speed_kph,
       ignition_on = EXCLUDED.ignition_on,
       status = EXCLUDED.status
     WHERE
       EXCLUDED.observed_at > vehicle_current_state.observed_at
       OR (
         EXCLUDED.observed_at = vehicle_current_state.observed_at
         AND EXCLUDED.event_id > vehicle_current_state.event_id
       )
     RETURNING vehicle_id`,
    [
      event.vehicleId,
      event.eventId,
      event.observedAt,
      event.latitude,
      event.longitude,
      event.speedKph,
      event.ignitionOn,
      status
    ]
  );

  return result.rowCount === 1;
}

export async function createOverspeedAlert(
  client: PoolClient,
  event: TelemetryEvent
): Promise<boolean> {
  if (event.speedKph <= 80) {
    return false;
  }

  const result = await client.query(
    `INSERT INTO alerts (event_id, vehicle_id, type)
     VALUES ($1, $2, 'OVERSPEED')
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [event.eventId, event.vehicleId]
  );

  return result.rowCount === 1;
}
