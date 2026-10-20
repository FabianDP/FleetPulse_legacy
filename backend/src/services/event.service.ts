import { pool } from "../config/database";
import {
  telemetryEventSchema,
  type TelemetryEvent
} from "../validators/event.validator";
import {
  findEventById,
  insertEvent,
  updateVehicleState,
  createOverspeedAlert
} from "../repositories/event.repository";

type BatchError = {
  index: number;
  eventId?: string;
  reason: string;
};

function sameEvent(
  existing: any,
  incoming: TelemetryEvent
): boolean {
  return (
    existing.eventId === incoming.eventId &&
    existing.vehicleId === incoming.vehicleId &&
    new Date(existing.observedAt).getTime() ===
      new Date(incoming.observedAt).getTime() &&
    existing.latitude === incoming.latitude &&
    existing.longitude === incoming.longitude &&
    existing.speedKph === incoming.speedKph &&
    existing.ignitionOn === incoming.ignitionOn
  );
}

export async function ingestBatch(events: unknown[]) {
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;

  const errors: BatchError[] = [];

  for (const [index, rawEvent] of events.entries()) {
    const parsed = telemetryEventSchema.safeParse(rawEvent);

    if (!parsed.success) {
      rejected++;

      errors.push({
        index,
        eventId:
          typeof rawEvent === "object" &&
          rawEvent !== null &&
          "eventId" in rawEvent &&
          typeof rawEvent.eventId === "string"
            ? rawEvent.eventId
            : undefined,
        reason: "INVALID_EVENT"
      });

      continue;
    }

    const event = parsed.data;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const inserted = await insertEvent(client, event);

      if (!inserted) {
        const existing = await findEventById(
          client,
          event.eventId
        );

        if (sameEvent(existing, event)) {
          duplicates++;
        } else {
          rejected++;
          errors.push({
            index,
            eventId: event.eventId,
            reason: "EVENT_ID_CONFLICT"
          });
        }

        await client.query("COMMIT");
        continue;
      }

      await updateVehicleState(client, event);
      await createOverspeedAlert(client, event);

      await client.query("COMMIT");
      accepted++;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    accepted,
    duplicates,
    rejected,
    errors
  };
}