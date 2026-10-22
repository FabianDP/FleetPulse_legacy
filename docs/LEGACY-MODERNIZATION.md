# Modernización del módulo legacy de FleetPulse

## 1. Contexto y objetivo

El módulo [legacy/ingest.js](../legacy/ingest.js) procesa telemetría GPS en memoria.
La modernización conserva su propósito —historial, último estado y alertas— y
lo implementa con validación explícita, PostgreSQL transaccional y API protegida.
El legacy permanece intacto como referencia de regresión.

El reto especializado del enunciado original de Detektor
exige al menos cuatro defectos observables, implementación robusta, regresiones y
este documento con antes/después, transición, integridad y rollback proporcionados.
Se contrastó con los [criterios de evaluación](CRITERIOS-EVALUACION.md) y el
[contrato común](common-spec.md).

## 2. Defectos diagnosticados y correcciones

Casos tomados del [fixture original](../fixtures/events.jsonl), procesado en su
orden de llegada, y del [oráculo detallado](../fixtures/expected_detailed.json).

| Defecto del legacy y referencia | Caso y efecto | Corrección moderna |
|---|---|---|
| [Inserción sin validación, línea 9](../legacy/ingest.js#L9) | E-006-03 tiene latitud inválida y E-007-03 velocidad inválida; ambos entran en history y reemplazan estados válidos. | Validar antes de escribir; rechazar con INVALID_LATITUDE/INVALID_SPEED e índice del lote, sin abortar por ese registro. |
| [Sin deduplicación, líneas 9–12](../legacy/ingest.js#L9-L12) | E-002-02 se repite y vuelve a generar alerta; E-001-02 también se almacena dos veces. Cada replay acumula más registros. | Clave global eventId persistente y comparación del payload: duplicado o EVENT_ID_CONFLICT, sin sobrescritura. |
| [Estado por llegada, línea 10](../legacy/ingest.js#L10) | E-001-00 llega tarde y sustituye temporalmente E-001-02. El duplicado posterior de E-001-02 oculta el defecto si solo se mira el resultado final. | Upsert condicionado por observedAt y desempate por eventId; conservar el evento antiguo en historial sin retroceder el estado. |
| [Umbral inclusivo, línea 11](../legacy/ingest.js#L11) | E-004-03 a 80 km/h alerta indebidamente. E-005-03 a 81 sí debe alertar. | Crear OVERSPEED solo si speedKph > 80, incluso para eventos tardíos. |

Además, el legacy no persiste entre procesos ni calcula OFF/MOVING/STOPPED.
Tampoco ofrece autenticación o resultados por registro. El
[diagnóstico inicial](ai-agent/iteration-01-diagnosis.md) identificó también defectos
del primer backend; no deben confundirse con código que existiera en el legacy.

## 3. Comparación antes/después

| Aspecto | Legacy | Implementación moderna |
|---|---|---|
| Almacenamiento | Objetos y arrays mutables en memoria | Eventos, estado y alertas en PostgreSQL |
| Validación | Ausente | Tipos, rangos, números finitos y fecha con zona |
| Identidad | Ignora colisiones | Unicidad global, duplicado frente a conflicto explícito |
| Último estado | Última llegada | Mayor instante, con desempate determinista |
| Atomicidad | Sin transacción | Transacción por evento |
| Alertas | >= 80 y repetibles | > 80, únicas por evento y posteriores al commit para SSE |
| Replay | Llamada directa al módulo | POST /api/events/batch local con X-API-Key del backend |

| Recorrido completo | Legacy: historial / alertas | Moderno: aceptados / duplicados / rechazados | Moderno: eventos / vehículos / alertas |
|---|---|---|---|
| Primero, desde estado limpio | 24 / 6 | 20 / 2 / 2 | 20 / 8 / 4 |
| Segundo, sin limpiar | 48 / 12 | 0 / 22 / 2 | 20 / 8 / 4 |

El legacy no devuelve contadores de aceptación, duplicado o rechazo: no se le
atribuyen valores que no calcula. Sus cantidades corresponden a memoria; las
modernas son el resultado contractual, respaldado por las evidencias de la sección 5.
Los rechazos del fixture están en índices 21 y 22, desde cero.

## 4. Diseño técnico de la ingesta moderna

**Validación.** El [validador](../backend/src/validators/event.validator.ts) exige
identificadores no vacíos, fechas ISO con zona, coordenadas en rango, velocidad
finita no negativa y encendido booleano. No convierte strings numéricos ni recorta
identificadores. El [servicio](../backend/src/services/event.service.ts) valida cada
registro, conserva índice y motivo y continúa ante rechazos de dominio.

**Idempotencia.** En el [repositorio](../backend/src/repositories/event.repository.ts),
`insertEvent` utiliza parámetros y `ON CONFLICT (event_id) DO NOTHING`. La clave
primaria del [esquema](../backend/database/schema.sql) arbitra inserciones concurrentes.
Si no inserta, se lee el original y `sameEvent` compara los campos del modelo:
payload igual cuenta como duplicado; distinto, como EVENT_ID_CONFLICT. La igualdad
temporal se resuelve en PostgreSQL con TIMESTAMPTZ, evitando truncar a milisegundos
en JavaScript. No se promete que las carreras reales estén exhaustivamente probadas.

**Transacciones.** Cada evento nuevo ejecuta BEGIN, inserción, actualización de
estado y posible alerta, seguido de COMMIT. Un fallo técnico solicita ROLLBACK y
libera la conexión. Un lote no es una única transacción: si falla un evento posterior,
los anteriores ya confirmados permanecen; el error técnico detiene el resto del lote.
Los contadores aceptados se incrementan después del commit.

**Eventos tardíos y estado.** `updateVehicleState` solo sustituye una fila si el
instante entrante es mayor o, en empate, su eventId es mayor según el orden de la
base. E-001-00 queda en el historial y genera alerta, pero no reemplaza E-001-02.
El estado calculado es OFF si ignitionOn es falso; MOVING si está encendido y la
velocidad es positiva; STOPPED si está encendido y la velocidad es cero.

**Alertas y SSE.** `createOverspeedAlert` aplica > 80 y la unicidad de event_id
impide duplicar alertas. Se respetan los booleanos devueltos por el repositorio:
vehicle.updated solo si cambió el último estado y alert.created solo si se creó
una alerta. Se publican después de COMMIT; duplicados, conflictos y rechazados no
publican. Un evento tardío puede emitir únicamente alert.created.

**Transporte.** El [adaptador HTTP](../backend/src/services/replay-http-client.ts)
envía cada evento al endpoint protegido en loopback, sin redirecciones ni reintentos
automáticos, con timeout y respuesta validada. API_KEY permanece en el backend.
El motor conserva la secuencia y espera el paso en vuelo al pausar. Reiniciar
restablece el progreso, no borra PostgreSQL. Ver [replay local](replay-local.md).

## 5. Evidencias de regresión y alcance

| Evidencia | Resultado y clasificación |
|---|---|
| [Ejecución histórica del legacy registrada en el diagnóstico inicial](ai-agent/iteration-01-diagnosis.md) | Reproducidos en memoria 24/6 y 48/12, estados inválidos, sustitución por E-001-00 y alerta a 80. No se usó PostgreSQL. |
| [ingestion.test.cjs](../backend/test/ingestion.test.cjs) | Validación del fixture, índices/motivos, duplicados, conflictos, rollback solicitado y umbral 80/81. Persistencia simulada. |
| [replay-http.test.cjs](../backend/test/replay-http.test.cjs) | HTTP y middleware reales con clave sintética; dos fixtures 20/2/2 y 0/22/2, 20 eventos en el repositorio simulado y 4 publicaciones de alerta. Sin publicaciones nuevas en el segundo recorrido. |
| [Registro de instalación](delivery-verification.md) | Ensayo histórico con PostgreSQL 18.6 nuevo: 20 eventos, 8 vehículos, 4 alertas; estados e historiales cotejados. Correspondía a la versión anterior al adaptador HTTP. |
| [Evidencias de IA](ai-development-evidence.md) | Conservan ejecuciones locales previas con 35 tests aprobados tras añadir HTTP, y la validación manual posterior registrada por el desarrollador. No equivalen a E2E automatizada de navegador. |
| Validación automatizada reciente reportada por el desarrollador | 35 pruebas backend y 6 Angular exitosas, 0 fallidas: 41 en total. Compilación de producción Angular satisfactoria. No se reejecutaron aquí; las 35 pruebas backend no son pruebas íntegramente contra PostgreSQL real. |
| [Suite Angular actual](../frontend/src/app/app.component.spec.ts) | Se inspeccionaron seis casos: creación, contadores, búsqueda con debounce, historial, vehicle.updated y stream.reconnected. Utilizan servicios simulados y eventos RxJS; no prueban una reconexión de red real. |
| Validación funcional reciente reportada por el desarrollador | Primer replay: 20/2/2, 8 vehículos y 4 alertas. Segundo sin limpiar PostgreSQL: 0/22/2, sin duplicación de vehículos ni alertas. Pausa/reanudación, actualización de vehículos e historial por SSE y recuperación tras reiniciar backend sin recargar la página comprobadas manualmente. Sin nuevos logs o capturas inspeccionados aquí. |

Las dos suites citadas se inspeccionaron; **no se reejecutaron para esta tarea
documental**. Los 35 tests son un resultado previo observado en la conversación y
registrado, no una ejecución nueva ni 35 pruebas contra PostgreSQL real.
La validación manual posterior acredita el flujo HTTP según el registro humano,
sin convertir el ensayo histórico de base de datos en una nueva prueba integral.

Las comprobaciones recientes amplían esa evidencia sin sustituir su cronología:
los resultados de ejecución son reportados por el desarrollador, mientras que la
existencia de los seis casos y la recuperación por `stream.reconnected` se
verificaron por lectura del código. La búsqueda conserva indicadores globales y
el historial seleccionado se refresca por SSE; al reconectar se consultan de nuevo
vehículos, alertas e historial seleccionado. Recuperar datos por GET no implica
almacenar ni reproducir todas las notificaciones SSE perdidas.

Las regresiones se relacionan con defectos concretos: validación rechaza lo que
legacy almacena; deduplicación evita el crecimiento del segundo replay; el upsert
evita retroceder por llegada tardía; la alerta a 80 desaparece. No existe una suite
única que ejecute ambas implementaciones bajo el mismo arnés y con PostgreSQL real:
consolidar ese contraste automatizado es un próximo paso, no una prueba ya realizada.

## 6. Transición progresiva propuesta

La demo moderna funciona; este es un plan de transición, no el relato de un corte
productivo ejecutado.

1. **Fijar contrato y línea base:** conservar fixture/oráculo y ejecutar el legacy
   aislado como referencia, sin otorgarle escritura sobre tablas modernas.
2. **Validar en aislamiento:** con autorización, preparar un proyecto/volumen de
   demostración nuevo según el [README](../README.md). Ejecutar ambos replays HTTP
   y comparar también identidades, estados e historiales, no solo cantidades.
3. **Preparar datos y esquema:** una base nueva recibe el esquema actual; una base
   antigua requiere revisar migraciones y respaldo. No importar history legacy a
   ciegas: separar inválidos y duplicados y resolver conflictos sin sobrescribir.
4. **Cambiar el productor de forma controlada:** detener su envío anterior y dirigir
   un alcance acotado al endpoint autenticado. Evitar dos escritores sobre la misma
   base; un ensayo en paralelo debe usar almacenamiento separado.
5. **Ampliar tras revisión humana:** contrastar resultados, errores e idempotencia
   y conservar una versión moderna conocida como válida antes de ampliar el alcance.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación y límite |
|---|---|
| Integridad por datos inválidos, conflictos o escritura externa | Validación y restricciones persistentes; restringir escritores. Las referencias SQL no verifican por sí solas la coherencia de todos los campos duplicados de estado/alerta. |
| Concurrencia | Claves únicas y upsert condicional; pendientes pruebas reales de solicitudes simultáneas iguales y contradictorias, y eventos del mismo vehículo. |
| Compatibilidad | Revisar TEXT frente a VARCHAR(100), precisión temporal y esquema antes de migrar o retroceder código. El texto indexado sigue sujeto a límites físicos. |
| Fallo tras commit o pérdida de respuesta | El reintento conserva idempotencia, pero puede contar un duplicado; abortar HTTP no garantiza rollback. No prometer contadores idénticos tras fallos de transporte. |
| Pérdida de notificación | Una caída entre COMMIT y SSE puede perder el aviso. Snapshot para recuperar estado; outbox pendiente si se exige entrega durable. |
| Pérdida de datos al restaurar | Respaldo y reconciliación de escrituras posteriores; nunca sustituir una base activa con una copia antigua sin plan y autorización. |
| Confundir instancias y credenciales | Aislar proyecto, volumen y puerto; el incidente registrado fue de configuración/autenticación, no evidencia de duplicación. No borrar datos para corregir credenciales. |

## 8. Plan proporcionado de rollback

**Propuesto, pendiente de aprobación y ensayo; no se afirma que se haya probado.**

1. Pausar replay y detener controladamente la entrada de nuevos eventos. Registrar
   versión, destino y último punto confirmado sin revelar secretos.
2. Preservar la base y obtener un respaldo autorizado; inventariar eventos escritos
   después del respaldo para no perderlos durante una eventual recuperación.
3. Restaurar la última versión **moderna** aprobada y compatible con el esquema.
   Si no existe una candidata válida, mantener la ingesta pausada mientras se corrige;
   no usar el legacy defectuoso como escritor de producción.
4. No revertir TEXT a VARCHAR(100) automáticamente. Si el esquema requiere cambios,
   validarlos primero en una copia aislada; preferir una corrección compatible que
   preserve datos. No confundir rollback de aplicación con restauración de base.
5. Verificar health, cantidades e identidades, historial y reintentos idempotentes
   antes de reabrir el envío. Restaurar datos solo por decisión humana y con un plan
   explícito para reconciliar las escrituras posteriores.

## 9. Participación de Codex y control humano

Codex realizó diagnóstico, cambios acotados y pruebas bajo instrucciones de no
alterar legacy/fixture ni hacer commit/push automático. La base inicial del backend
ya existía: no se atribuye toda la persistencia al agente. La trazabilidad completa
está en [ai-development-evidence.md](ai-development-evidence.md).

La [revisión humana 02](ai-agent/review-02.md) aprueba seguridad, validación y pruebas,
y registra respaldo, migración y verificación de TEXT por el desarrollador; no se
inspeccionó aquí un backup ni un log SQL que convierta ese registro en ensayo nuevo.
Posteriormente el desarrollador identificó y aprobó corregir la llamada directa
del replay para atravesar HTTP. La corrección se incorporó en `2016183`; seguridad
y consultas/SSE son trazables a `abae2f4` y `ebd1003`. Los commits acreditan cambios,
no por sí solos ejecuciones exitosas o autoría por línea.

## 10. Limitaciones y próximos pasos

- Revalidar ambos replays HTTP con PostgreSQL independiente autorizado y ampliar
  concurrencia, recuperación tras fallo y comparación automatizada legacy/moderno.
- Ensayar y aprobar rollback; definir objetivos de recuperación antes de producción.
- Incorporar E2E de navegador y completar video/capturas sin secretos. Build Angular
  y las seis pruebas Angular con servicios simulados no reemplazan esa evidencia.
- Mantener explícito el límite de una instancia para replay/SSE; valorar outbox,
  coordinación y paginación según necesidades reales.
- Aprobar este documento y completar la evidencia de entrega del PDF; los demás
  entregables documentales quedan fuera del alcance de este archivo.

Esta actualización documental no modifica código, esquema ni fixtures,
no crea ni borra recursos PostgreSQL y no ejecuta un rollback.
