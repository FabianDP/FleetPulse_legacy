# Revisión manual — API de consultas y SSE

## Objetivo

Validar la implementación de consultas y comunicación en tiempo real realizada con apoyo de Codex.

## Funcionalidades verificadas

- Consulta de vehículos y búsqueda por identificador.
- Filtro de vehículos por estado.
- Historial cronológico por vehículo.
- Consulta de alertas por exceso de velocidad.
- Comunicación SSE mediante `GET /api/stream`.
- Publicación de eventos `vehicle.updated` y `alert.created`.
- Reconocimiento de eventos duplicados.

## Resultados

- TypeScript: sin errores.
- Compilación: exitosa.
- Pruebas automatizadas: 15 aprobadas.
- Vehículos del fixture oficial: 8.
- Alertas del fixture oficial: 4.
- Historial de VEH-001: orden cronológico correcto.
- Evento de prueba DEMO-SSE-001: aceptado.
- SSE: notificaciones de actualización y alerta recibidas.
- Segundo envío: identificado como duplicado.

## Decisión

Se aprueba la implementación de consultas y SSE para integrarla a la rama de desarrollo.

## Limitaciones pendientes

- Pruebas de concurrencia contra PostgreSQL real.
- SSE limitado a un único proceso.
- Sin almacenamiento durable de notificaciones SSE.
- Paginación del historial pendiente.
- Verificación adicional de seguridad antes de un despliegue público. 