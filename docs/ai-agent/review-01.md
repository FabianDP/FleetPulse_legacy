# FleetPulse — Revisión manual de la primera iteración

## Objetivo

Evaluar el diagnóstico realizado por Codex sobre la modernización del sistema legacy de telemetría GPS.

## Decisiones técnicas

| Hallazgo | Decisión | Justificación |
|---|---|---|
| Orden incorrecto de middlewares | Aceptado | El parser JSON debe ejecutarse antes de las rutas HTTP. |
| Ausencia de X-API-Key | Aceptado | La ingesta debe estar protegida mediante configuración de entorno. |
| Motivos de validación genéricos | Aceptado | Debemos cumplir el contrato y facilitar el diagnóstico de eventos rechazados. |
| Unicidad e idempotencia en PostgreSQL | Mantener y probar | El diseño utiliza restricciones persistentes, pero requiere pruebas de integración. |
| Control de eventos fuera de orden | Mantener y probar | La actualización condicional es adecuada, pero debe verificarse con los fixtures. |
| Restricciones adicionales de identificadores | Requiere revisión | No debemos imponer límites incompatibles con el contrato sin documentarlos. |
| SSE, Angular y reproductor | Pendiente | Se implementarán después de estabilizar la ingesta. |

## Decisión de implementación

Se autoriza una segunda iteración enfocada en seguridad, manejo de errores HTTP, validación y pruebas automatizadas.

No se autoriza modificar los archivos originales de `legacy/`, `fixtures/` ni las especificaciones oficiales.

Todos los cambios generados deberán revisarse y ejecutarse antes de incorporarse a la rama `dev`.