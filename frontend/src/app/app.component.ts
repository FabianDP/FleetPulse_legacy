import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FleetService } from './core/services/fleet.service';
import { Vehicle } from './core/models/vehicle.model';
import { FleetAlert } from './core/models/alert.model';
import { OnDestroy } from '@angular/core';
import { Subject, Subscription, catchError, of, switchMap, timer } from 'rxjs';
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
  private searchSubscription?: Subscription;
  private readonly searchRequests = new Subject<number>();
  searchText = '';
  filteredVehicles: Vehicle[] = [];
  searchLoading = false;
  searchError = '';

  searchVehicles(text: string): void {
    this.searchText = text;
    this.refreshTable(text ? 300 : 0);
  }

  private refreshTable(delayMs = 0): void {
    this.searchLoading = true;
    this.searchError = '';
    this.searchRequests.next(delayMs);
  }

  loadVehicles(): void {
    this.fleetService.getVehicles().subscribe({
      next: (data) => {
        this.vehicles = data;
        this.loading = false;
        this.error = '';
        this.refreshTable();
      },
      error: () => {
        this.error = 'No se pudieron cargar los vehículos.';
        this.loading = false;
      },
    });
  }

  ngOnDestroy(): void {
    this.streamSubscription?.unsubscribe();
    this.searchSubscription?.unsubscribe();
    this.searchRequests.complete();
  }
  vehicles: Vehicle[] = [];
  loading = true;
  error = '';

  ngOnInit(): void {1
    // Cancel both the debounce timer and any HTTP request on each new input/refresh.
    this.searchSubscription = this.searchRequests.pipe(
      switchMap(delayMs => timer(delayMs).pipe(
        switchMap(() => this.searchText
          ? this.fleetService.getVehicles(this.searchText)
          : of(this.vehicles)),
        catchError(() => {
          this.searchError = 'No se pudo realizar la búsqueda de vehículos.';
          return of(this.filteredVehicles);
        }),
      )),
    ).subscribe(vehicles => {
      this.filteredVehicles = vehicles;
      this.searchLoading = false;
    });
    this.loadVehicles();
    this.loadAlerts();

    this.streamSubscription = this.streamService.connect().subscribe({
      next: (eventType) => {
        if (eventType === 'vehicle.updated') {
          this.loadVehicles();
          if (this.selectedVehicle){
             this.refreshSelectedVehicleHistory();
          }
        }

        if (eventType === 'alert.created') {
          this.loadAlerts();
        }
        if(eventType=== 'stream.reconnected'){
          this.loadVehicles();
          this.loadAlerts();
          if(this.selectedVehicle){
            this.refreshSelectedVehicleHistory();
          }
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
  refreshSelectedVehicleHistory():void{
    const vehicleId = this.selectedVehicle;
    if(!vehicleId)return;
    this.fleetService.getVehicleEvents(vehicleId).subscribe({
      next:(event)=>{
        if (this.selectedVehicle !==vehicleId) return;
        this.vehicleEvents=event;
        this.historyError="";
      },
        error: () => {
        if (this.selectedVehicle !== vehicleId) return;
        this.historyError = 'No se pudo cargar el historial.';
      },
    })
  }

}
