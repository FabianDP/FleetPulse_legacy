/**
 * Implementacion heredada del modulo de telemetria.
 * Tiene defectos intencionales; analizar antes de modernizar.
 * Sin dependencias externas; ejecutar con Node.js.
 */
function ingest(state, events) {
  state = state || { history: [], current: {}, alerts: [] };
  for (const e of events) {
    state.history.push(e);
    state.current[e.vehicleId] = e;
    if (e.speedKph >= 80) {
      state.alerts.push({ vehicleId: e.vehicleId, eventId: e.eventId, type: 'OVERSPEED' });
    }
  }
  return state;
}
module.exports = { ingest };
