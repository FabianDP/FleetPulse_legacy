# Criterios públicos de evaluación

La puntuación máxima es 100. P0 designa el mínimo evaluado; P1 son mejoras opcionales que NO restan puntos.
Se valoran resultados observables, criterio y documentación de trade-offs, no el volumen de código ni el uso de servicios de pago.

## Núcleo común, 70 puntos
- 25 pts: backend, API, datos correctos, persistencia e idempotencia.
- 15 pts: Angular, actualizaciones SSE o WebSocket y reproductor funcional.
- 15 pts: pruebas automatizadas, casos adversariales, validación y seguridad.
- 10 pts: uso real de agentes, decisiones humanas y correcciones verificadas.
- 5 pts: GitHub, README, reproducibilidad, CI y video.

## Reto especializado, 30 puntos
- 8 pts: diagnóstico sustentado de cuatro defectos del módulo legacy.
- 10 pts: refactorización e ingesta moderna sin duplicados ni corrupción de estado.
- 8 pts: regresiones demostrables: legacy falla, implementación nueva pasa.
- 4 pts: propuesta razonable de transición, riesgos y rollback.

## Evidencia mínima
- Dos replays en video: primero 20 aceptados, 2 duplicados y 2 rechazados; segundo 0 aceptados, 22 duplicados y 2 rechazados.
- Verificaciones de estados, alertas, evento tardío, umbral 80, API key, GitHub y CI.
- Demostración de IA agéntica real con planificación, revisión y corrección humanas.
- Una omisión P0 documentada se califica por lo efectivamente demostrado; ningún extra P1 reemplaza funcionalidad crítica.
- Entrega en cuatro días calendario; máximo sugerido 16 a 20 horas efectivas; se admite defensa técnica breve.
