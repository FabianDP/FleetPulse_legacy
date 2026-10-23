import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { AppComponent } from './app.component';
import { FleetService } from './core/services/fleet.service';
import { StreamService, StreamEventType } from './core/services/stream.service';
import { Vehicle } from './core/models/vehicle.model';
import { TelemetryEvent } from './core/models/telemetry-event.model';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

describe('AppComponent - FleetPulse', () => {
  let fleetService: jasmine.SpyObj<FleetService>;
  let streamEvents: Subject<StreamEventType>;

  const vehicles: Vehicle[] = [
    {
      eventId: 'E-001',
      vehicleId: 'VEH-001',
      observedAt: '2026-10-22T10:00:00Z',
      latitude: 4.6,
      longitude: -74.1,
      speedKph: 35,
      ignitionOn: true,
      status: 'MOVING',
    },
    {
      eventId: 'E-002',
      vehicleId: 'VEH-002',
      observedAt: '2026-10-22T10:01:00Z',
      latitude: 4.7,
      longitude: -74.2,
      speedKph: 0,
      ignitionOn: true,
      status: 'STOPPED',
    },
    {
      eventId: 'E-003',
      vehicleId: 'VEH-003',
      observedAt: '2026-10-22T10:02:00Z',
      latitude: 4.8,
      longitude: -74.3,
      speedKph: 0,
      ignitionOn: false,
      status: 'OFF',
    },
  ];

  beforeEach(async () => {
    fleetService = jasmine.createSpyObj<FleetService>('FleetService', [
      'getVehicles',
      'getAlerts',
      'getVehicleEvents',
    ]);

    streamEvents = new Subject<StreamEventType>();

    const streamService = jasmine.createSpyObj<StreamService>('StreamService', [
      'connect',
    ]);

    fleetService.getVehicles.and.returnValue(of(vehicles));
    fleetService.getAlerts.and.returnValue(of([]));
    fleetService.getVehicleEvents.and.returnValue(of([]));
    streamService.connect.and.returnValue(streamEvents.asObservable());

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FleetService, useValue: fleetService },
        { provide: StreamService, useValue: streamService },
      ],
    }).compileComponents();
  });
  //    TEST 01 - Inicialización del dashboard. Verifica que Angular pueda crear correctamente AppComponent //
  it('debe crear el dashboard', () => {
    const fixture = TestBed.createComponent(AppComponent);

    expect(fixture.componentInstance).toBeTruthy();
  });
  //    TEST 02 - Contadores de vehículos.Comprueba que los indicadores MOVING, STOPPED y OFF se calculen correctamente a partir de los vehículos cargados. //
  it('debe calcular correctamente los estados de vehículos', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    app.vehicles = vehicles;

    expect(app.totalVehicles).toBe(3);
    expect(app.movingVehicles).toBe(1);
    expect(app.stoppedVehicles).toBe(1);
    expect(app.offVehicles).toBe(1);
  });
  //    TEST 03 - Búsqueda de vehículos.Valida que el identificador ingresado se envíe al servicio,que se respete el debounce de 300 ms y que los resultados se reflejen en la lista filtrada //
  it('debe buscar vehículos por identificador', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    fleetService.getVehicles
      .withArgs('VEH-001')
      .and.returnValue(of([vehicles[0]]));

    app.ngOnInit();
    tick(0);

    app.searchVehicles('VEH-001');
    tick(300);

    expect(fleetService.getVehicles).toHaveBeenCalledWith('VEH-001');
    expect(app.filteredVehicles.length).toBe(1);
    expect(app.filteredVehicles[0].vehicleId).toBe('VEH-001');

    fixture.destroy();
  }));
  //    TEST 04 - Historial GPS.Verifica que al seleccionar un vehículo se consulte su historial y se actualicen los registros del componente. //
  it('debe cargar el historial del vehículo seleccionado', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    const events = [
      {
        eventId: 'E-001',
        vehicleId: 'VEH-001',
      },
    ] as TelemetryEvent[];

    fleetService.getVehicleEvents.and.returnValue(of(events));

    app.selectVehicle('VEH-001');

    expect(fleetService.getVehicleEvents).toHaveBeenCalledWith('VEH-001');
    expect(app.vehicleEvents.length).toBe(1);
    expect(app.historyLoading).toBeFalse();
  });
  //     TEST 05 - Actualización en tiempo real mediante SSE. Simula la recepción de vehicle.updated y comprueba que se actualicen los vehículos y el historial seleccionado.//
  it('debe actualizar vehículos e historial al recibir SSE', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    app.ngOnInit();
    tick(0);

    app.selectVehicle('VEH-001');

    fleetService.getVehicles.calls.reset();
    fleetService.getVehicleEvents.calls.reset();

    streamEvents.next('vehicle.updated');
    tick(0);

    expect(fleetService.getVehicles).toHaveBeenCalled();
    expect(fleetService.getVehicleEvents).toHaveBeenCalledWith('VEH-001');

    fixture.destroy();
  }));
  //     TEST 06 - Recuperación después de reconexión SSE. Simula stream.reconnected y verifica que el dashboard vuelva a consultar vehículos, alertas e historial GPS. //
  it('debe recuperar los datos cuando SSE se reconecta', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;

    app.ngOnInit();
    tick(0);

    app.selectVehicle('VEH-001');

    fleetService.getVehicles.calls.reset();
    fleetService.getAlerts.calls.reset();
    fleetService.getVehicleEvents.calls.reset();

    streamEvents.next('stream.reconnected');
    tick(0);

    expect(fleetService.getVehicles).toHaveBeenCalled();
    expect(fleetService.getAlerts).toHaveBeenCalled();
    expect(fleetService.getVehicleEvents).toHaveBeenCalledWith('VEH-001');

    fixture.destroy();
  }));
});
