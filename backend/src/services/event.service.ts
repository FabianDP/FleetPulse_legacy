import { pool } from "../config/database";
import { streamService, type StreamMessage } from "./stream.service";
import {
  telemetryEventSchema,
  eventRejectionReason,
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
  existing: (Omit<TelemetryEvent, "observedAt"> & { sameObservedAt: boolean }) | undefined,
  incoming: TelemetryEvent
): boolean {
  return (
    existing !== undefined && existing.eventId === incoming.eventId &&
    existing.vehicleId === incoming.vehicleId &&
    existing.sameObservedAt &&
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
        reason: eventRejectionReason(parsed.error)
      });

      continue;
    }

    const event = parsed.data;
    const notifications: StreamMessage[] = [];
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const inserted = await insertEvent(client, event);

      if (!inserted) {
        const existing = await findEventById(
          client,
          event.eventId,
          event.observedAt
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

      const stateChanged = await updateVehicleState(client, event);
      const alertCreated = await createOverspeedAlert(client, event);
      const envelope = { eventId: event.eventId, vehicleId: event.vehicleId, observedAt: event.observedAt };
      if (stateChanged) {
        const status = !event.ignitionOn ? "OFF" : event.speedKph > 0 ? "MOVING" : "STOPPED";
        notifications.push({ ...envelope, type: "vehicle.updated", data: { ...event, status } });
      }
      if (alertCreated) {
        notifications.push({ ...envelope, type: "alert.created", data: { ...event, type: "OVERSPEED" } });
      }

      await client.query("COMMIT");
      accepted++;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    // Outside the transaction handler: a notification must never cause rollback.
    for (const notification of notifications) streamService.publish(notification);
  }

  return {
    accepted,
    duplicates,
    rejected,
    errors
  };
}
