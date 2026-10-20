import { selectAlerts, selectVehicleHistory, selectVehicles } from "../repositories/dashboard.repository";
import type { AlertQuery, VehicleQuery } from "../validators/query.validator";

export const listVehicles = (filters: VehicleQuery) => selectVehicles(filters);
export const vehicleHistory = (vehicleId: string) => selectVehicleHistory(vehicleId);
export const listAlerts = (filters: AlertQuery) => selectAlerts(filters);
