import { z } from "zod";

const text = z.string().min(1);
export const vehicleQuerySchema = z.object({
  search: text.optional(),
  vehicleId: text.optional(),
  status: z.enum(["OFF", "MOVING", "STOPPED"]).optional()
}).strict();
export const alertQuerySchema = z.object({
  vehicleId: text.optional(),
  type: z.literal("OVERSPEED").optional()
}).strict();
export const vehicleParamsSchema = z.object({ vehicleId: text });
export type VehicleQuery = z.infer<typeof vehicleQuerySchema>;
export type AlertQuery = z.infer<typeof alertQuerySchema>;
