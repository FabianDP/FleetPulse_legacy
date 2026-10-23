# Flujo de trabajo con IA agéntica — FleetPulse

## Objetivo y herramienta

FleetPulse es una prueba técnica para Detektor que moderniza una ingesta GPS
legacy mediante Node.js/TypeScript, PostgreSQL, Angular y SSE. Se utilizó **Codex**
para analizar código, proponer cambios acotados, implementar bajo instrucciones,
preparar pruebas y documentar evidencias. No existe evidencia de participación de
otros agentes ni de una organización con múltiples agentes.

El backend, el validador y parte de la persistencia ya existían al comenzar el
diagnóstico. Este documento no atribuye a Codex todo el código del proyecto.
Resume el proceso; la trazabilidad ampliada está en
[ai-development-evidence.md](ai-development-evidence.md) y el análisis técnico en
[LEGACY-MODERNIZATION.md](LEGACY-MODERNIZATION.md).

## Planificación y reparto de responsabilidades

| Desarrollador | Codex |
|---|---|
| Fijar contrato, prioridades y restricciones; autorizar el alcance. | Inspeccionar requisitos y código; separar defectos comprobados de riesgos. |
| Revisar diffs, compatibilidad y seguridad; decidir qué incorporar. | Proponer e implementar cambios revisables reutilizando la arquitectura. |
| Realizar comprobaciones manuales y registrar decisiones. | Preparar pruebas, ejecutar comprobaciones autorizadas y declarar sus límites. |
| Conservar responsabilidad sobre datos, credenciales, Git y entrega. | No borrar datos ni hacer commit/push sin autorización. |

El trabajo avanzó desde diagnóstico sin edición a seguridad, consultas/SSE,
dashboard, replay, instalación y CI. Las iteraciones siguientes agrupan hitos;
no renumeran las revisiones originales. Los fragmentos entre comillas son
**literales disponibles en el historial de interacción y conservados en las
evidencias**; el resto de las instrucciones se presenta como resumen, no como
transcripción reconstruida.

## Iteración 1: diagnóstico y seguridad de la ingesta

**Objetivo.** Detectar defectos del legacy y corregir los bloqueos del backend
sin sustituir las protecciones de persistencia existentes.

**Instrucciones literales:** «Por ahora NO modifiques ningún archivo» y,
posteriormente, «He revisado tu diagnóstico y apruebo corregir los problemas
críticos relacionados con seguridad, middlewares, validación y manejo de errores».

**Resultado.** El diagnóstico identificó ausencia de validación y deduplicación,
estado por llegada y alerta indebida a 80 km/h en el legacy. En el backend se
corrigieron orden de middlewares, X-API-Key, errores HTTP y motivos de rechazo;
se preservaron transacciones y actualización cronológica. También se revisaron
identificadores y comparación temporal para evitar incompatibilidades.

**Validación y revisión.** La [revisión 01](ai-agent/review-01.md) delimita lo
autorizado. La [revisión 02](ai-agent/review-02.md) registra typecheck, build y
**9 pruebas aprobadas**, además de 401/403 y comprobación humana de respaldo y
migración a TEXT. Las pruebas automatizadas de ingesta usan persistencia simulada;
el registro de migración no equivale a una suite integral de PostgreSQL real.

**Evidencia.** [Diagnóstico inicial](ai-agent/iteration-01-diagnosis.md), revisiones
citadas y commit `abae2f4` (seguridad, validación, pruebas y documentos de revisión).

## Iteración 2: consultas y actualización mediante SSE

**Objetivo.** Proporcionar consultas para el dashboard y avisos de cambios
confirmados, sin emitir por duplicados o transacciones revertidas.

**Instrucciones, resumen del pedido disponible.** Implementar consultas de
vehículos, historial ordenado y alertas; conexión SSE persistente con heartbeat
y limpieza; publicar únicamente después de COMMIT. Mantener SQL parametrizado
y la estructura routes/services/repositories.

**Resultado.** Se incorporaron consultas, stream y pruebas en `ebd1003`. El
dashboard Angular aparece en `d6aec01`; su prompt original de creación no está
disponible, por lo que no se reconstruye ni se atribuye íntegramente a Codex.

**Validación y revisión.** La [revisión 03](ai-agent/review-03.md) registra
**15 pruebas aprobadas**, typecheck/build, 8 vehículos, 4 alertas, historial
cronológico, recepción SSE y reconocimiento de un segundo envío como duplicado.
Aprueba consultas/SSE. Las pruebas automatizadas correspondientes sustituyen la
persistencia; las verificaciones manuales registradas son evidencia diferenciada.
No se deduce de esta aprobación una revisión específica de todo el frontend.

## Iteración 3: replay y corrección posterior por revisión humana

**Objetivo.** Reproducir los 24 eventos progresivamente con controles, contadores
y procesamiento secuencial, reutilizando la ingesta.

**Instrucción literal:** «Necesito implementar el replay progresivo con controles
visuales en Angular, REUTILIZANDO la arquitectura existente».

**Resultado inicial.** `b03c040` incorporó motor y controles. Se registraron
**23 pruebas aprobadas** con persistencia simulada. Reiniciar volvía al primer
evento sin borrar PostgreSQL. Sin embargo, el motor invocaba directamente
`ingestBatch`: reutilizaba las reglas, pero incumplía el transporte exigido por
el [contrato de demo](Documentos_originales/DEMO-REPLAY.md).

**Decisión de IA corregida por el desarrollador.** El desarrollador detectó esa
diferencia, pidió primero un análisis de impacto sin editar y aprobó después el
cambio mínimo a HTTP autenticado. La instrucción literal fue: «Apruebo implementar
el cambio propuesto para que el reproductor de FleetPulse envíe cada evento
mediante HTTP a `POST /api/events/batch`, cumpliendo el contrato oficial».

**Corrección y validación.** `2016183` añadió el adaptador HTTP exclusivo del
backend, con fetch nativo, X-API-Key desde el entorno, timeout, errores seguros y
sin reintentos automáticos. Se conservaron controles, SSE y reglas de ingesta.
Las 26 pruebas previas más 9 de transporte dieron **35 aprobadas**, según el
registro histórico: HTTP y autenticación reales mediante sockets, con repositorio
simulado en los casos de persistencia. Cubren controles, errores y ausencia de
nuevas emisiones por duplicados. La comprobación manual posterior del desarrollador
consta en la [corrección documentada](ai-development-evidence.md#corrección-posterior-a-la-revisión-humana-transporte-http-del-replay).

La aprobación corrigió la solución inicial; no convierte retroactivamente el
primer replay en una implementación HTTP ni acredita una nueva suite con PostgreSQL real.

## Iteración 4: revisión humana y mejoras recientes del frontend

**Objetivo y resultado.** Completar búsqueda, actualización del historial
seleccionado y recuperación del dashboard tras reconexión SSE. La búsqueda usa
el endpoint existente con debounce y cancelación, separando resultados de tabla
de los datos de los indicadores. El frontend actual procesa `vehicle.updated`
para refrescar vehículos e historial seleccionado y `stream.reconnected` para
consultar nuevamente vehículos, alertas e historial sin recargar la página.

**Participación y decisiones.** El historial disponible acredita intervención de
Codex en la búsqueda y su build. Las mejoras posteriores de reconexión, refresco
del historial y sustitución de las pruebas scaffold se registran como trabajo y
revisión del desarrollador; no hay evidencia para atribuirlas al agente. No se
inventan prompts originales ni un commit o aprobación adicional para esta etapa.

**Validación reciente reportada por el desarrollador.** 35 pruebas backend y
6 Angular aprobadas, 0 fallidas, y build de producción Angular satisfactorio.
La [suite Angular inspeccionada](../frontend/src/app/app.component.spec.ts) cubre
creación, contadores, búsqueda con debounce, historial, `vehicle.updated` y
`stream.reconnected`. Usa servicios simulados y un Subject para SSE: acredita
comportamiento del componente, no una reconexión de red ni PostgreSQL real.
No se reejecutaron esas pruebas en esta actualización documental.

**Revisión funcional manual reportada.** Ambos replays dieron 20/2/2 y 0/22/2,
con 8 vehículos y 4 alertas y sin duplicación posterior. El desarrollador comprobó
pausa/reanudación, refresco de vehículos e historial por SSE, reinicio del backend
y recuperación automática del dashboard. No se presentan como E2E automatizada
ni se inventan capturas o logs. Se conserva la evidencia histórica anterior.

## Problemas y límites de las recomendaciones de IA

- **Cumplimiento parcial:** reutilizar directamente la ingesta en replay omitió
  un requisito explícito de transporte. La revisión humana exigió corregirlo.
- **Recomendación no adoptada literalmente:** el diagnóstico proponía fallar al
  arrancar si faltaba API_KEY; la solución documentada responde 503 en ingesta.
  No consta una decisión humana individual sobre ese detalle; se distingue la
  recomendación del comportamiento implementado.
- **Documentación que requirió ajustes:** en el historial de interacción el
  desarrollador señaló un proyecto Compose fijo junto al dinámico, instrucciones
  duplicadas y repetición sobre Reiniciar. Solicitó conservar un único procedimiento
  seguro; los cambios documentales figuran en `1840e8a`.

Estos casos muestran por qué un resultado generado requiere contraste con el
contrato y revisión del diff, aunque compile o supere pruebas.

## Validación humana y evidencia reproducible

Los commits acreditan cambios incorporados, no autoría por línea ni pruebas
ejecutadas. Pueden inspeccionarse con `git show --stat <SHA>` y
`git show <SHA> -- <ruta>`. Las revisiones enlazadas documentan decisiones humanas;
no se inventan logs, capturas o aprobaciones adicionales.

| Evidencia histórica | Alcance y límite |
|---|---|
| Instalación reproducible, `c4b53ae` y [registro](delivery-verification.md) | PostgreSQL real aislado: primer replay 20 aceptados/2 duplicados/2 rechazados; segundo 0/22/2; resultado 20 eventos, 8 vehículos y 4 alertas. Anterior al adaptador HTTP. |
| Transporte HTTP, `2016183` y actualización documental `facdf3c` | 35 tests históricos; no confundir sockets HTTP reales con persistencia PostgreSQL real. Comprobación manual posterior registrada, sin suite E2E automatizada de navegador. |
| CI, ejecución aprobada [39728088976](https://github.com/FabianDP/FleetPulse_legacy/actions/runs/39728088976) | Commit `aa424d926df5eabbeaf3579e3686b9e2bc5e9244`. Según la evidencia aprobada aportada por el desarrollador, los resultados de los jobs backend y frontend se verificaron mediante GitHub Actions. No se afirma inspección de todos los logs ni ejecución de pruebas nuevas para este documento. |
| CI, referencia histórica: `fa23c4e` y [ejecución 39715958010](https://github.com/FabianDP/FleetPulse_legacy/actions/runs/39715958010) | El desarrollador aportó resultado success en dev para `facdf3c4ad13602f1047c39ba35cef7c7b368c6d`, jobs backend y frontend. Se conserva como evidencia histórica. |

Los conteos históricos 9, 15, 23, 26 y 35 corresponden a etapas diferentes,
no se suman entre sí. La validación reciente reportada reúne 35 backend y
6 Angular: **41 pruebas exitosas, 0 fallidas**, con los límites indicados arriba.
Para esta tarea se inspeccionaron documentos y Git; **no se reejecutaron suites,
builds ni ensayos de PostgreSQL**. Un build Angular no acredita pruebas de UI.

## Responsabilidad final y pendientes

La IA no reemplaza el contrato, la revisión de seguridad ni el criterio sobre
migraciones y datos. El incidente registrado de dos copias con contraseñas
distintas apuntando al mismo PostgreSQL fue de configuración/autenticación, no
evidencia de duplicación. No se atribuye a Codex una reproducción independiente.

Quedan por completar video/capturas sin secretos, E2E automatizada completa de UI
y concurrencia real, y aprobación y ensayo de la estrategia de rollback. Las seis
pruebas Angular y la recuperación SSE ya están implementadas; no sustituyen esos
ensayos pendientes. No se afirma que ese
rollback haya sido ensayado. Los prompts ausentes y las evidencias humanas sin
logs adjuntos conservan ese límite. El desarrollador decide la aprobación final,
la incorporación a Git y la publicación; este documento queda para su revisión.
