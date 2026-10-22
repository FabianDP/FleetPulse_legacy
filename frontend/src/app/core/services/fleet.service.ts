import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
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

  getVehicles(search?: string): Observable<Vehicle[]> {
    const params = search ? new HttpParams().set('search', search) : new HttpParams();
    return this.http.get<Vehicle[]>(`${this.apiUrl}/vehicles`, { params });
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
