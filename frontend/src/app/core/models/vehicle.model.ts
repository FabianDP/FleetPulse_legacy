export type VehicleStatus = 'MOVING' | 'STOPPED' | 'OFF';

export interface Vehicle {
  eventId: string;
  vehicleId: string;
  observedAt: string;
  latitude: number;
  longitude: number;
  speedKph: number;
  ignitionOn: boolean;
  status: VehicleStatus;
}