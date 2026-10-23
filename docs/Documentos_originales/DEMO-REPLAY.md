# Reproductor/simulador de eventos · requisito obligatorio

## Objetivo
Demostrar que FleetPulse funciona EN VIVO. No basta importar el fixture instantáneamente ni mostrar una tabla cargada: deben verse cambios de estado y alertas en Angular sin actualizar la página.

## Implementación
Construir un reproductor ligero (CLI interactiva o UI de pruebas):
1. Leer `fixtures/events.jsonl` en el orden de sus 24 líneas, sin ordenar por `observedAt`.
2. Enviar progresivamente cada evento a `POST /api/events/batch` mediante `{"events":[evento]}` (o pequeños lotes observables). Intervalo configurable, sugerido 750 ms.
3. Permitir iniciar, pausar, reanudar y reiniciar desde el primer registro. Mostrar índice de línea, progreso, aceptados, duplicados, rechazados y motivo de errores.
4. Usar `X-API-Key` leída de variable de entorno. La clave nunca debe aparecer en Angular, GitHub, logs ni video.
5. Crear un mecanismo seguro para limpiar datos sintéticos LOCALES: script de reset o recreación de volumen de prueba. No crear endpoint público de borrado.
6. Documentar comandos exactos y permitir reproducir la demostración sin intervención manual en la base.

## Dos pruebas distintas
- **Reset local y primera reproducción**: total 24, nuevos 20, duplicados 2, rechazados 2, vehículos 8, alertas 4. Deben coincidir las identidades de último evento del oráculo.
- **Reinicio del reproductor SIN reset de datos**: total 24, nuevos 0, duplicados 22, rechazados 2; siguen 20 eventos persistidos, 8 vehículos y 4 alertas. No se emiten notificaciones por duplicados.
- `E-001-00` llega TARDE (95 km/h), crea alerta pero no reemplaza `E-001-02`. `E-004-03` con 80 NO alerta; `E-005-03` con 81 SÍ alerta.
- Demostrar en pantalla que al pausar no ingresan nuevos eventos y al reanudar continúan; el dashboard debe seguir conectado al stream.
- La UI puede recuperar snapshot al iniciar/reconectar, pero las actualizaciones posteriores deben venir de SSE o WebSockets.

## Video (8-12 minutos, máximo 15)
Mostrar simultáneamente reproductor y Angular: arranque limpio, replay progresivo, pausa/reanudación, estadísticas, alertas, segundo replay idempotente, pruebas/CI, decisiones humanas e IA, y desafío especializado. Enlazar video accesible desde README de GitHub.

No se pide generar eventos aleatorios ni animar vehículos en un mapa. Una CLI simple y funcional es suficiente; no es necesario usar servicios de pago.
