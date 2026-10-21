export interface FleetAlert {
  id: string;
  eventId: string;
  vehicleId: string;
  observedAt: string;
  speedKph: number;
  type: 'OVERSPEED';
  createdAt: string;
}