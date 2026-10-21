export interface TelemetryEvent {
  eventId: string;
  vehicleId: string;
  observedAt: string;
  latitude: number;
  longitude: number;
  speedKph: number;
  ignitionOn: boolean;
}