import { z } from "zod";

const isoDateWithTimezone = z
  .string()
  .datetime({ offset: true });

export const telemetryEventSchema = z.object({
  eventId: z.string().min(1),
  vehicleId: z.string().min(1),
  observedAt: isoDateWithTimezone,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  speedKph: z.number().finite().nonnegative(),
  ignitionOn: z.boolean()
});

export const batchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(1000)
});

export function eventRejectionReason(error: z.ZodError): string {
  const field = error.issues[0]?.path[0];
  const reasons: Record<string, string> = {
    eventId: "INVALID_EVENT_ID",
    vehicleId: "INVALID_VEHICLE_ID",
    observedAt: "INVALID_OBSERVED_AT",
    latitude: "INVALID_LATITUDE",
    longitude: "INVALID_LONGITUDE",
    speedKph: "INVALID_SPEED",
    ignitionOn: "INVALID_IGNITION"
  };
  return typeof field === "string" ? reasons[field] ?? "INVALID_EVENT" : "INVALID_EVENT";
}

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;
