import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Vehicle } from '../models/vehicle.model';
import { FleetAlert } from '../models/alert.model';
import { TelemetryEvent } from '../models/telemetry-event.model';

@Injectable({
  providedIn: 'root',
})
export class FleetService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = 'http://localhost:3000/api';

  getVehicles(): Observable<Vehicle[]> {
    return this.http.get<Vehicle[]>(`${this.apiUrl}/vehicles`);
  }
  getAlerts(): Observable<FleetAlert[]> {
    return this.http.get<FleetAlert[]>(`${this.apiUrl}/alerts`);
  }
  getVehicleEvents(vehicleId: string): Observable<TelemetryEvent[]> {
    return this.http.get<TelemetryEvent[]>(
      `${this.apiUrl}/vehicles/${encodeURIComponent(vehicleId)}/events`,
    );
  }
}
