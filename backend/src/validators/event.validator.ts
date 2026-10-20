import { z } from "zod";

const isoDateWithTimezone = z
  .string()
  .datetime({ offset: true });

export const telemetryEventSchema = z.object({
  eventId: z.string().trim().min(1),
  vehicleId: z.string().trim().min(1),
  observedAt: isoDateWithTimezone,
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  speedKph: z.number().finite().nonnegative(),
  ignitionOn: z.boolean()
}).strict();

export const batchSchema = z.object({
  events: z.array(z.unknown()).min(1).max(1000)
}).strict();

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;