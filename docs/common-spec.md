# FleetPulse · Contrato común v2

Se usan solo eventos sintéticos; fechas ISO 8601 con zona, comparadas por su instante real. Los eventos deben mantener el orden original de llegada del fixture, no clasificarse por fecha antes de ingestar.

## Modelo y dominio
- `eventId`: string no vacío y clave única global; `vehicleId` string no vacío.
- `observedAt`: fecha ISO 8601 válida con zona. `latitude`: número finito [-90,90], `longitude`: número finito [-180,180], `speedKph`: número finito >=0, `ignitionOn` booleano.
- Persistir eventos válidos y únicos, incluidos antiguos; no permitir duplicados ni duplicar alertas.
- Evento con `eventId` existente y mismo payload: duplicado; `eventId` existente y payload distinto: conflicto explícito, sin sobrescritura. Una restricción única persistente debe proteger contra concurrencia. Documentar cómo se resuelve.
- Último estado según mayor `observedAt`, nunca por orden de llegada. En empates futuros definir desempate determinista (el fixture no tiene empates).
- `OVERSPEED` por cada evento válido aceptado con velocidad estrictamente superior a 80; incluso si llega tarde. No alertas de duplicados ni rechazados.
- Estado `OFF` si no encendido; `MOVING` si encendido y velocidad >0; `STOPPED` si encendido y velocidad=0.
- Lote parcialmente válido: informar aceptados, duplicados, rechazados, índice y motivo; no abortar todo por un registro inválido.

## API mínima y formato
- `POST /api/events/batch` con cuerpo JSON `{"events":[...]}`, protegido mediante `X-API-Key` definida por variable de entorno en el REPRODUCTOR y servidor, nunca en Angular.
- Respuesta JSON mínima `{"accepted":0,"duplicates":0,"rejected":0,"errors":[{"index":0,"eventId":"E-...","reason":"MOTIVO"}]}`; índice es relativo a ese lote. Se admiten campos adicionales.
- `GET /api/vehicles` devuelve estado más reciente y admite búsqueda por vehículo.
- `GET /api/vehicles/:id/events` devuelve historial ordenado por `observedAt` ascendente y desempate `eventId`. Documentar 404 o [] para desconocidos.
- `GET /api/alerts` incluye alertas históricas. Los filtros especializados están definidos en el reto individual.
- `GET /api/health` y `GET /api/stream` SSE o WebSocket equivalente.
- Clave ausente/incorrecta: responder 401/403. Validar JSON malformado, tipos, tamaño del lote y cuerpo. No exponer secretos ni stack traces. La demo es local: no exponer stream/panel sin control a Internet.

## Contrato de tiempo real
- Emitir `vehicle.updated` cuando el evento cambia el último estado y `alert.created` cuando se crea una alerta. Mensajes con `type`, `eventId`, `vehicleId`, `observedAt` y datos del cambio.
- No notificar duplicados ni inválidos. Un evento antiguo que genere alerta puede emitir `alert.created` sin `vehicle.updated`.
- Al abrir/reconectar cliente, obtener snapshot GET y continuar escuchando stream; no se exige un buffer SSE persistente. Demostrar dos clientes simultáneos.

## Frontend Angular
Tabla de vehículo, última fecha, velocidad, encendido y estado; búsqueda, historial, contador de alertas. Debe mostrar cambios recibidos por SSE/WebSocket sin recargar. Mapa opcional.

## Simulador obligatorio
Leer `docs/DEMO-REPLAY.md`. Se entregan 24 eventos, oráculos `fixtures/expected_sample.json` y `fixtures/expected_detailed.json`. La primera reproducción en base limpia debe dar 20 aceptados, 2 duplicados, 2 rechazados, 8 vehículos, 4 alertas. Sin limpiar base, segunda reproducción: 0 aceptados, 22 duplicados, 2 rechazados, y siguen exactamente 20 eventos persistidos y 4 alertas.

## Prioridad y límites
Cuatro días calendario desde el correo, 16–20 horas efectivas sugeridas. Prioridad P0: datos correctos, UI con tiempo real, replay controlable, tests, documentación y reto especializado mínimo. P1: mapas, analítica avanzada, nube y optimización. Explicar omisiones y decisiones; se prefiere funcionalidad probada a elementos decorativos.
