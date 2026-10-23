# Retrospectiva técnica — FleetPulse

## Objetivo y alcance entregado

FleetPulse moderniza el módulo legacy de telemetría GPS para la prueba técnica
de Detektor. El alcance implementado comprende ingesta validada y autenticada,
persistencia PostgreSQL, consultas de vehículos/historial/alertas, dashboard
Angular con búsqueda e historial, actualizaciones y recuperación tras reconexión
SSE, y replay progresivo mediante HTTP protegido. También incluye instalación
local reproducible, pruebas backend y Angular, y CI.

El alcance se contrasta con el [contrato común](Documentos_originales/common-spec.md), los
[criterios de evaluación](Documentos_originales/CRITERIOS-EVALUACION.md) y el
[requisito de replay](Documentos_originales/DEMO-REPLAY.md). Es una demostración local de una sola
instancia; no se presenta como plataforma productiva distribuida ni como entrega
sin pendientes de evidencia. El video obligatorio sigue pendiente de adjuntar.

## Logros técnicos y decisiones arquitectónicas

| Implementación | Razón y resultado |
|---|---|
| Separación routes/services/repositories y validación explícita | Reutilizar la arquitectura existente y aislar HTTP, reglas de dominio y SQL parametrizado. Los registros inválidos reciben motivo e índice sin invalidar los demás por ese rechazo. |
| PostgreSQL con unicidad global de eventId | Resolver duplicados y conflictos en almacenamiento persistente, sin depender de una comprobación previa vulnerable a carreras. Payload distinto produce EVENT_ID_CONFLICT sin sobrescritura. |
| Transacción por evento | Confirmar historial, estado y alerta juntos. Un fallo técnico posterior no revierte los eventos anteriores del lote ya confirmados. |
| Estado por observedAt y desempate por eventId | Conservar eventos tardíos en el historial sin retroceder el último estado. Las comparaciones temporales de identidad se realizan en PostgreSQL. |
| Alertas estrictamente por encima de 80 km/h | Corregir el umbral del legacy; un evento tardío válido puede alertar aunque no actualice el estado. La unicidad impide alertas repetidas. |
| SSE después de COMMIT | Notificar solo cambios confirmados; no publicar por duplicados, rechazos o rollback. Heartbeat y limpieza limitan recursos por conexión. |
| Angular con consultas y EventSource | Búsqueda con debounce y cancelación sin alterar indicadores globales; refresco de vehículos e historial seleccionado por vehicle.updated. Al recibir stream.reconnected, recuperar vehículos, alertas e historial sin recargar la página. |
| Replay HTTP secuencial con cola y timer controlado | Mantener orden del fixture, pausa/reanudación/reinicio e intervalo configurable. Reutilizar el endpoint existente sin duplicar validación o persistencia. |
| Adaptador HTTP exclusivo del backend | Mantener X-API-Key fuera de Angular, con destino loopback, timeout, respuesta validada y errores seguros, sin reintentos automáticos. |

Las decisiones de seguridad incluyen autenticación de ingesta, errores HTTP
centralizados y sesión independiente para los controles locales de replay.
CORS no se utiliza como sustituto de autenticación. La instalación documenta
proyectos y volúmenes de demostración independientes; **Reiniciar no borra
PostgreSQL**. Los detalles están en el [README](../README.md) y en la
[modernización del legacy](LEGACY-MODERNIZATION.md).

## Dificultades principales y resolución

- **Defectos heredados:** el legacy aceptaba inválidos y duplicados, actualizaba
  por llegada y alertaba a 80. Se conservaron sus fuentes y fixtures como referencia;
  la implementación moderna añadió las protecciones descritas y regresiones.
- **Bloqueos del primer backend:** orden de middlewares, ausencia de X-API-Key y
  motivos genéricos. Se corrigieron antes de ampliar consultas y tiempo real.
- **Identidad y fechas:** límites arbitrarios y normalización podían contradecir
  el contrato. Se revisaron identificadores TEXT y comparación temporal SQL.
- **Replay funcional pero transporte incorrecto:** la primera versión llamaba
  directamente a ingestBatch. La revisión humana exigió POST /api/events/batch;
  un adaptador acotado corrigió el contrato sin reescribir la ingesta.
- **Dos copias contra PostgreSQL con contraseñas distintas:** el incidente
  reportado fue de configuración/autenticación, no de datos duplicados. Se
  documentó aislamiento de instancia, puerto y credenciales; no borrar datos
  como respuesta a un error de conexión. Falta evidencia redactada de su resolución.

## Validaciones y alcance de la evidencia

La [evidencia de desarrollo](ai-development-evidence.md) conserva los resultados
históricos; no se ejecutaron pruebas nuevas para preparar esta retrospectiva.

| Evidencia | Resultado y límite |
|---|---|
| Suite backend tras el transporte HTTP | Registro de 35 pruebas aprobadas. Incluye HTTP/auth y SSE reales mediante sockets, con persistencia simulada en los casos correspondientes; no son 35 pruebas de PostgreSQL real. |
| Validación automatizada reciente reportada por el desarrollador | 35 backend y 6 Angular: **41 pruebas exitosas, 0 fallidas**. Build de producción Angular satisfactorio. No se reejecutaron en esta tarea. |
| [Suite Angular actual](../frontend/src/app/app.component.spec.ts) inspeccionada | Seis casos: creación, contadores, búsqueda con debounce, historial, vehicle.updated y stream.reconnected. Servicios y eventos SSE simulados; no constituye E2E de navegador contra backend/PostgreSQL. |
| Instalación aislada con PostgreSQL real | El [registro de instalación](delivery-verification.md) acredita ambos replays, estados e historiales con el motor real, en la versión anterior al adaptador HTTP. |
| Comprobación manual posterior del desarrollador | Registra replay desde Angular con solicitudes HTTP de ingesta y avance de 24 eventos. No equivale a una suite automatizada E2E ni a repetir el ensayo aislado de base. |
| Comprobación funcional reciente reportada por el desarrollador | Ambos replays con los conteos oficiales, sin duplicar vehículos ni alertas; pausa/reanudación, actualización de vehículos e historial por SSE y recuperación tras reiniciar el backend sin recarga manual. Sin nuevos logs o capturas inspeccionados aquí. |
| Builds y CI | Compilaciones históricas satisfactorias y resultados de jobs documentados en [AI-WORKFLOW](AI-WORKFLOW.md). No acreditan pruebas funcionales de navegador ni todos los escenarios operativos. |

Los resultados oficiales y registrados son: primer replay **20 aceptados,
2 duplicados y 2 rechazados**; segundo, sin limpiar, **0 aceptados, 22 duplicados
y 2 rechazados**. El resultado persistido se mantiene en **20 eventos,
8 vehículos y 4 alertas**. Deben contrastarse también identidades y orden,
no solo cantidades. La evidencia real previa y las pruebas HTTP simuladas
conservan sus alcances diferenciados.

## Deuda técnica: hechos y riesgos potenciales

| Clasificación | Hallazgo y consecuencia |
|---|---|
| Pendiente anterior resuelto | Las expectativas scaffold se sustituyeron por seis pruebas del dashboard actual. Existencia y alcance verificados por lectura; ejecución exitosa reportada por el desarrollador. Sigue pendiente una suite E2E completa. |
| Limitación anterior resuelta | stream.reconnected provoca nuevas consultas de vehículos, alertas e historial seleccionado. Código inspeccionado, caso automatizado con evento simulado y recuperación real tras reinicio reportada manualmente. No implica entrega durable de todos los avisos perdidos. |
| Limitación comprobada | SSE, sesiones y progreso del replay residen en memoria del proceso. No hay buffer durable de notificaciones ni checkpoint persistente de reproducción. Reiniciar el proceso no elimina los eventos ya confirmados en PostgreSQL. |
| Cobertura pendiente | Las restricciones SQL protegen unicidad y actualización condicional, pero falta ampliar pruebas concurrentes con PostgreSQL real. No se ha demostrado corrupción concurrente. |
| Riesgo potencial | Una caída entre COMMIT y publicación puede perder un aviso SSE sin perder el evento persistido. No se garantiza entrega exactamente una vez. |
| Riesgo potencial | Un timeout o respuesta perdida puede ocurrir después del commit. Reanudar puede contabilizar duplicado; abortar HTTP no garantiza rollback SQL. |
| Límite operativo | No consta ensayo de restauración/rollback ni suite E2E automatizada completa de navegador. Historial y alertas carecen de paginación; su coste puede crecer con el volumen. |

El [plan de rollback](LEGACY-MODERNIZATION.md#8-plan-proporcionado-de-rollback)
es una propuesta pendiente de aprobación y ensayo: preservar datos, pausar entrada
y recuperar una versión moderna compatible. No propone reactivar el legacy
defectuoso como escritor ni restaurar una copia antigua sobre datos nuevos sin
reconciliación.

## Lecciones sobre IA y revisión humana

Codex ayudó a inspeccionar, implementar cambios acotados, preparar pruebas y
documentar. El desarrollador fijó límites, revisó resultados y corrigió la
decisión de transporte del replay. No se atribuye todo el proyecto a la IA ni
se presume participación de múltiples agentes.

La principal lección es que reutilización y pruebas satisfactorias no sustituyen
la lectura literal del contrato. Conviene revisar requisitos antes del código,
separar análisis de implementación y distinguir salidas ejecutadas de afirmaciones
manuales. La [trazabilidad del flujo de IA](AI-WORKFLOW.md) conserva esas decisiones
sin reconstruir prompts ausentes ni inventar aprobaciones.

## Próximos pasos por prioridad

1. **Ampliar cobertura de recuperación:** a partir de la reconexión y las seis
   pruebas Angular implementadas, cubrir desconexiones repetidas, errores de GET
   y la ventana entre snapshot y suscripción; conservar filtro e historial.
2. **Consolidar integración:** repetir ambos replays HTTP contra PostgreSQL aislado
   autorizado y automatizar concurrencia, conflictos y eventos tardíos; incorporar
   un recorrido de navegador para controles y actualización sin recarga.
3. **Ensayar recuperación:** aprobar y probar backup/restauración y rollback en
   aislamiento, reconciliando escrituras posteriores y verificando compatibilidad.
4. **Preparar crecimiento solo si se requiere:** paginación, métricas y pruebas de
   carga; evaluar outbox, coordinación entre instancias y checkpoint de replay
   según los requisitos de entrega y recuperación.

Con más tiempo se priorizaría evidencia reproducible y recuperación frente a
funciones visuales opcionales. También se revisaría el toolchain y sus dependencias
mediante una auditoría específica, sin confundir avisos históricos de paquetes
obsoletos con vulnerabilidades confirmadas.

## Estado del proyecto

FleetPulse entrega una modernización funcional para demostración local, con
integridad persistente, búsqueda, historial, replay HTTP autenticado y recuperación
automática del dashboard tras reconexión SSE. Las verificaciones históricas y las
41 pruebas exitosas y comprobaciones manuales recientes reportadas respaldan el
alcance con los límites indicados. El video y la aprobación documental siguen
pendientes; concurrencia real, E2E automatizada completa y ensayo de rollback
requieren trabajo adicional antes de plantear un uso productivo más amplio.
