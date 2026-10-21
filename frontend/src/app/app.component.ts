import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FleetService } from './core/services/fleet.service';
import { Vehicle } from './core/models/vehicle.model';
import { FleetAlert } from './core/models/alert.model';
import { OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { StreamService } from './core/services/stream.service';
import { TelemetryEvent } from './core/models/telemetry-event.model';
import { ReplayControlsComponent } from './replay-controls/replay-controls.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ReplayControlsComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  private readonly fleetService = inject(FleetService);
  private readonly streamService = inject(StreamService);
  private streamSubscription?: Subscription;

  loadVehicles(): void {
    this.fleetService.getVehicles().subscribe({
      next: (data) => {
        this.vehicles = data;
        this.loading = false;
        this.error = '';
      },
      error: () => {
        this.error = 'No se pudieron cargar los vehículos.';
        this.loading = false;
      },
    });
  }

  ngOnDestroy(): void {
    this.streamSubscription?.unsubscribe();
  }
  vehicles: Vehicle[] = [];
  loading = true;
  error = '';

  ngOnInit(): void {
    this.loadVehicles();
    this.loadAlerts();

    this.streamSubscription = this.streamService.connect().subscribe({
      next: (eventType) => {
        if (eventType === 'vehicle.updated') {
          this.loadVehicles();
        }

        if (eventType === 'alert.created') {
          this.loadAlerts();
        }
      },
    });
  }
  get totalVehicles(): number {
    return this.vehicles.length;
  }

  get movingVehicles(): number {
    return this.vehicles.filter((v) => v.status === 'MOVING').length;
  }

  get stoppedVehicles(): number {
    return this.vehicles.filter((v) => v.status === 'STOPPED').length;
  }

  get offVehicles(): number {
    return this.vehicles.filter((v) => v.status === 'OFF').length;
  }

  alerts: FleetAlert[] = [];
  alertsError = '';

  loadAlerts(): void {
    this.fleetService.getAlerts().subscribe({
      next: (data) => {
        this.alerts = data;
        this.alertsError = '';
      },
      error: () => {
        this.alertsError = 'No se pudieron cargar las alertas.';
      },
    });
  }

  selectedVehicle = '';
  vehicleEvents: TelemetryEvent[] = [];
  historyLoading = false;
  historyError = '';

  selectVehicle(vehicleId: string): void {
    this.selectedVehicle = vehicleId;
    this.vehicleEvents = [];
    this.historyLoading = true;
    this.historyError = '';

    this.fleetService.getVehicleEvents(vehicleId).subscribe({
      next: (events) => {
        if (this.selectedVehicle !== vehicleId) return;
        this.vehicleEvents = events;
        this.historyLoading = false;
      },
      error: () => {
        if (this.selectedVehicle !== vehicleId) return;
        this.historyError = 'No se pudo cargar el historial.';
        this.historyLoading = false;
      },
    });
  }
}
