-- FleetPulse - PostgreSQL Schema
-- Eventos GPS válidos y únicos

CREATE TABLE IF NOT EXISTS telemetry_events (
    event_id VARCHAR(100) PRIMARY KEY,
    vehicle_id VARCHAR(100) NOT NULL,
    observed_at TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed_kph DOUBLE PRECISION NOT NULL,
    ignition_on BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 
 CONSTRAINT chk_latitude
    CHECK (
        latitude BETWEEN -90 AND 90
    ),

CONSTRAINT chk_longitude
    CHECK (
        longitude BETWEEN -180 AND 180
    ),

CONSTRAINT chk_speed
    CHECK (
        speed_kph >= 0
        AND speed_kph < 'Infinity'::float8
    )
);

-- Último estado conocido de cada vehículo

CREATE TABLE IF NOT EXISTS vehicle_current_state (
    vehicle_id VARCHAR(100) PRIMARY KEY,
    event_id VARCHAR(100) NOT NULL UNIQUE
        REFERENCES telemetry_events(event_id),
    observed_at TIMESTAMPTZ NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed_kph DOUBLE PRECISION NOT NULL,
    ignition_on BOOLEAN NOT NULL,
    status VARCHAR(20) NOT NULL,

    CONSTRAINT chk_vehicle_status
        CHECK (status IN ('OFF', 'MOVING', 'STOPPED'))
);

-- Alertas por exceso de velocidad

CREATE TABLE IF NOT EXISTS alerts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id VARCHAR(100) NOT NULL UNIQUE
        REFERENCES telemetry_events(event_id),
    vehicle_id VARCHAR(100) NOT NULL,
    type VARCHAR(30) NOT NULL DEFAULT 'OVERSPEED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_alert_type
        CHECK (type = 'OVERSPEED')
);

-- Índices para consultas de historial y alertas

CREATE INDEX IF NOT EXISTS idx_events_vehicle_date
ON telemetry_events(vehicle_id, observed_at, event_id);

CREATE INDEX IF NOT EXISTS idx_alerts_vehicle
ON alerts(vehicle_id);