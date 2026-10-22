# Evidencias de desarrollo asistido por IA — FleetPulse

## Contexto del proyecto y objetivo de la prueba técnica

FleetPulse moderniza una ingesta legacy de telemetría GPS con Node.js/TypeScript,
PostgreSQL, Angular 19 y SSE. La entrega debe demostrar integridad de datos,
idempotencia, actualizaciones visibles, replay controlable, seguridad, pruebas y
reproducibilidad. Los [criterios de evaluación](CRITERIOS-EVALUACION.md) incluyen
evidencia de uso real de agentes y de revisión y corrección humanas.

Este documento se apoya en el repositorio, el historial Git hasta `fa23c4e`, los
documentos de revisión y la conversación de Codex disponible al prepararlo.
No constituye una transcripción completa ni atribuye automáticamente a la IA
todo el código que aparece en un commit. Solo se identifica a Codex como agente;
no hay evidencia de trabajo con varios subagentes.

### Clasificación de evidencias

| Marca | Significado |
|---|---|
| **Verificado** | Código, commits o documentos inspeccionados; cuando se describe una ejecución, existe salida de herramientas en la conversación visible. |
| **Revisión humana registrada** | El desarrollador dejó una verificación o aprobación en un documento del repositorio. Se verifica la existencia del registro, no se repite automáticamente su ejecución. |
| **Reportado por el desarrollador** | Afirmación explícita disponible, sin log o captura independiente adjunta. |
| **Pendiente** | Falta una fuente, aprobación o evidencia publicable. |

Las cinco iteraciones siguientes son una agrupación para esta entrega. No
renumeran los documentos `review-01`, `review-02` y `review-03`: aquellos reflejan
pasos más pequeños de diagnóstico, seguridad y consultas/SSE. Las fechas de la
tabla corresponden a metadatos Git, no a horas certificadas de conversación.

| Hito | Commit | Fecha Git, UTC−05:00 |
|---|---|---|
| Backend y PostgreSQL iniciales | `84853ea` | 2026-10-20 |
| Validador inicial | `543cb2b` | 2026-10-20 |
| Incorporación de requisitos, fixture y base de ingesta | `836a94d` | 2026-10-20 |
| Ingesta segura y revisiones de IA | `abae2f4` | 2026-10-20 |
| Consultas y SSE | `ebd1003` | 2026-10-20 |
| Primera versión Angular | `d6aec01` | 2026-10-20 |
| Replay integrado | `b03c040` | 2026-10-21 |
| Instalación reproducible | `c4b53ae` | 2026-10-21 |
| GitHub Actions | `fa23c4e` | 2026-10-21 |

Para inspeccionar cada evidencia en un clon: `git show --stat <commit>` y
`git show <commit> -- <ruta>`. Los commits acreditan cambios incorporados, no una
autoría individual por línea ni la ejecución satisfactoria de CI.

## Diagnóstico inicial del código legado

**Objetivo.** Contrastar el legacy y el backend existente con el
[contrato común](common-spec.md), sin modificar archivos inicialmente.

**Instrucción original disponible, fragmento literal:**

> Por ahora NO modifiques ningún archivo.

El pedido también exigía distinguir hallazgos comprobados de riesgos potenciales.
El backend, su validador y parte de la persistencia ya existían al comenzar esta
revisión; no se presentan como una creación completa del agente desde cero.

| Defecto del legacy | Impacto observado o sustentado en código |
|---|---|
| No valida eventos | Conserva los dos registros inválidos y permite que sustituyan estados válidos. |
| No distingue duplicados/conflictos de eventId | Un segundo replay vuelve a acumular registros y alertas. |
| Estado por orden de llegada | Un evento tardío puede sustituir temporalmente uno más reciente. |
| Umbral `>= 80` | Crea una alerta indebida a exactamente 80 km/h. |

La ejecución visible de `legacy/ingest.js` sobre el fixture dio 24 registros y
6 alertas en el primer recorrido; 48 y 12 tras repetirlo. Son resultados del
estado en memoria legacy, no filas de PostgreSQL. El diagnóstico también encontró
router antes del parser JSON, ausencia de autenticación, errores genéricos y API
de consulta/stream pendiente. Reconoció como aciertos la unicidad persistente y
el upsert cronológico existentes.

**Evidencia:** [diagnóstico conservado](ai-agent/iteration-01-diagnosis.md),
[legacy original](../legacy/ingest.js) y
[revisión humana inicial](ai-agent/review-01.md), incorporados junto con las
correcciones en `abae2f4`. No se modificó el legacy para ocultar sus defectos.

## Iteración 1: análisis e implementación del backend, persistencia y APIs

**Objetivo.** Corregir seguridad, validación y errores; conservar la persistencia
transaccional y completar las consultas necesarias para el dashboard.

**Instrucción original disponible, fragmento literal:**

> He revisado tu diagnóstico y apruebo corregir los problemas críticos relacionados con seguridad, middlewares, validación y manejo de errores.

En un pedido posterior se autorizaron consultas y SSE, manteniendo TypeScript
estricto, SQL parametrizado y publicación después de COMMIT. Ambos pedidos
prohibían alterar fixtures, borrar datos o hacer commits/push automáticos.

**Archivos modificados.** En `abae2f4`: `backend/src/app.ts`, rutas de eventos,
validador, servicio y repositorio de ingesta; nuevos middlewares de API key y
errores; `backend/database/schema.sql`, migración `002-identifiers-text.sql`,
`backend/test/ingestion.test.cjs`, scripts npm y documentación. En `ebd1003`:
router, servicio, repositorio y validador de dashboard; middleware local;
servicio SSE; ajustes en ingesta y arranque; `backend/test/dashboard.test.cjs`.
Los listados completos están en esos commits.

**Resultado verificado.** Parser/CORS preceden a las rutas; la ingesta exige
X-API-Key, con 401 si falta y 403 si es incorrecta. Los rechazos incluyen
`INVALID_LATITUDE`, `INVALID_SPEED` y `EVENT_ID_CONFLICT`. Identificadores TEXT
sin recorte arbitrario; comparación temporal de duplicados en PostgreSQL.
La base protege eventId con una clave primaria y las alertas con unicidad.
Consultas de vehículos, historial ordenado y alertas quedan disponibles.

**Validaciones.** La conversación registra 9 pruebas aprobadas tras seguridad y
15 tras consultas/SSE, además de typecheck y build. Esas suites sustituyen la
persistencia por dobles; sus respuestas HTTP y conexiones SSE sí son reales.
No equivalen a una demostración de concurrencia real en PostgreSQL.

**Decisión humana.** [review-01](ai-agent/review-01.md) autoriza las correcciones;
[review-02](ai-agent/review-02.md) aprueba la segunda revisión y registra respaldo,
migración y verificación de TEXT realizados por el desarrollador. El respaldo y
la ejecución de esa migración son **revisión humana registrada**, sin archivo de
backup ni log SQL adjunto inspeccionado aquí. No se afirma que Codex los ejecutara.

**Evidencia verificable:** `abae2f4`, `ebd1003`, los documentos citados y las suites
[ingesta](../backend/test/ingestion.test.cjs) y
[dashboard](../backend/test/dashboard.test.cjs).

## Iteración 2: desarrollo de Angular y actualización en tiempo real mediante SSE

**Objetivo.** Mostrar vehículos, indicadores, historial y alertas sin recargar
la página, consumiendo las API y el stream existentes.

**Instrucciones al agente.** El prompt original de creación del dashboard Angular
**no está disponible en la conversación visible**. No se reconstruye ni se
atribuye toda su implementación a Codex. Sí está disponible el pedido del backend
SSE y los pedidos posteriores que declaran el dashboard funcional y exigen
reutilizarlo sin reescribir tabla, indicadores, alertas o historial.

**Archivos modificados.** `d6aec01` incorpora el proyecto Angular: `app.component.*`,
configuración, modelos y servicios `fleet.service.ts` y `stream.service.ts`.
El backend SSE corresponde a `ebd1003`, compartido con la iteración anterior.

**Resultado verificado.** El frontend usa HttpClient para snapshots e historial y
EventSource para escuchar `vehicle.updated` y `alert.created`. Las notificaciones
disparan nuevas consultas GET, evitando una recarga completa del navegador.
El servidor ofrece heartbeat, limpieza y desconexión de clientes lentos, y solo
publica cambios después de confirmar la transacción.

**Validaciones.** Las pruebas de backend comprueban dos clientes SSE, mensajes,
desconexión y ausencia de publicaciones en duplicados/rollback. Los builds Angular
observados posteriormente en la conversación fueron satisfactorios; no se dispone
de una ejecución histórica independiente del build justo en `d6aec01`.
Build no significa tests de UI ni E2E aprobados.

**Decisión humana.** [review-03](ai-agent/review-03.md) aprueba consultas y SSE:
registra 8 vehículos, 4 alertas, historial de VEH-001 y repetición idempotente del
evento sintético DEMO-SSE-001. La interacción previa al replay declara el dashboard
operativo. La aprobación específica del frontend y sus prompts originales requieren
complemento humano si se quiere documentar su autoría asistida con más precisión.

**Evidencia verificable:** `d6aec01`, `ebd1003`,
[componente raíz](../frontend/src/app/app.component.ts),
[cliente SSE](../frontend/src/app/core/services/stream.service.ts) y review-03.
No se localizaron capturas o videos de demostración entre los archivos del proyecto
inspeccionados, excluyendo dependencias y copias locales de verificación.

## Iteración 3: implementación del replay GPS, controles e idempotencia

**Objetivo.** Reproducir progresivamente las 24 líneas, controlar el avance desde
Angular y conservar validación, persistencia y SSE existentes.

**Instrucción original disponible, fragmento literal:**

> Necesito implementar el replay progresivo con controles visuales en Angular, REUTILIZANDO la arquitectura existente.

Se exigieron intervalo por defecto de 750 ms, iniciar/pausar/reanudar/reiniciar,
contadores, protección local y ausencia de API_KEY en Angular. Reiniciar debía
volver al primer evento sin borrar PostgreSQL.

**Archivos modificados.** `b03c040`: `backend/src/services/replay.service.ts`,
`routes/replay.routes.ts`, `middlewares/replay-session.middleware.ts`, integración
en app/servidor, `backend/test/replay.test.cjs`; servicio Angular de replay y los
tres archivos de `ReplayControlsComponent`; integración mínima en el componente
raíz y [guía de replay](replay-local.md).

**Resultado verificado.** Cola serial y un timer reprogramado después de cada
paso, con invalidación de timers antiguos. Pausa/reinicio esperan el evento en vuelo.
El motor llama a `ingestBatch`; duplicados y rechazados no crean avisos adicionales.
El componente consulta progreso; la telemetría continúa por SSE. La autorización
usa una contraseña independiente y sesión HttpOnly/SameSite=Strict, más controles
locales. CORS no concede por sí solo acceso al replay.

**Validaciones.** La conversación registra 23 pruebas aprobadas al incorporar el
replay, builds correctos y dos recorridos del fixture con repositorio simulado.
La comprobación posterior con PostgreSQL nuevo se describe en la iteración 4.

**Decisión humana.** El desarrollador definió controles, restricciones y reutilización.
En su pedido de instalación declaró que replay y dashboard ya se habían probado
manualmente. Ese resultado visual es **reportado por el desarrollador**; falta
captura/video para el evaluador.

**Límite contractual que requiere aprobación.** La demo oficial exige enviar el fixture mediante POST /api/events/batch con X-API-Key. La implementación inicial de esta iteración reutilizaba directamente ingestBatch dentro del servidor, por lo que no cumplía literalmente el requisito de transporte HTTP.
Durante la revisión humana de los documentos de la prueba técnica se identificó esta diferencia. Posteriormente se corrigió mediante un cliente HTTP interno del backend, conservando la lógica de validación, persistencia e idempotencia. La corrección y sus pruebas se documentan en la sección «Corrección posterior a la revisión humana: transporte HTTP del replay».

**Evidencia verificable:** `b03c040`,
[motor](../backend/src/services/replay.service.ts),
[pruebas](../backend/test/replay.test.cjs) y [guía](replay-local.md).
El mensaje del commit contiene «E2E», pero eso no acredita una suite automatizada
de navegador ni sustituye evidencia de ejecución.

## Iteración 4: instalación reproducible y verificación con PostgreSQL nuevo

**Objetivo e instrucción original disponible, fragmento literal:**

> Que un evaluador pueda clonar el repositorio y levantar el sistema desde cero, sin usar configuraciones personales del desarrollador.

El pedido prohibió reutilizar el contenedor/volumen PostgreSQL existente,
sobrescribir el entorno personal o afirmar instalación limpia sin probarla.

**Archivos modificados.** `c4b53ae`: `compose.yaml`, `.env.example`, `.nvmrc`,
generador `scripts/setup-env.cjs`, cargadores de entorno del backend, arranque,
`backend/test/configuration.test.cjs`, refuerzo de pruebas de replay, `.gitignore`,
README y documentación de instalación/verificación.

**Resultado verificado.** Compose independiente con healthcheck y puerto local
configurable; generación exclusiva de credenciales sin imprimirlas; `.env` raíz
cargado antes del pool. El esquema nuevo ya usa TEXT: se inicializa únicamente
`schema.sql`, sin aplicar también una migración para instalaciones antiguas.

**Validaciones observadas en la conversación y registradas en
[delivery-verification](delivery-verification.md):**

- Instalaciones desde cero con lockfiles; en Node 22/Linux, descargas npm con
  caché vacía. Typecheck, 26 pruebas y builds de backend/Angular correctos.
- PostgreSQL 18.6 real en volumen nuevo: health correcto, dos replays y comparación
  de estados e historiales con el oráculo. Pausa/reanudación verificadas por HTTP.
- Sesión obligatoria, rechazo de Origin externo y ausencia de SSE nuevos en la
  segunda reproducción. Se conservó el volumen y se detuvo solo el contenedor nuevo.
- El ensayo real de PostgreSQL se realizó desde Windows/Node 24. Node 22 cubrió
  instalación, tests con mocks y builds; no se afirma una segunda prueba real de
  PostgreSQL bajo Node 22 ni una prueba visual de navegador en ese ensayo.

**Decisión humana.** El desarrollador exigió aislamiento y preservación de datos.
Las ejecuciones fuera del sandbox se realizaron mediante solicitudes de aprobación
de las herramientas. El commit incorpora el resultado; no consta una revisión
manual adicional numerada para esta fase.

### Incidente: dos copias compartiendo PostgreSQL con contraseñas diferentes

**Fuente: reportado y diagnosticado como confirmado por el desarrollador en la
solicitud de este documento.** Dos copias de FleetPulse intentaron usar el mismo
PostgreSQL con contraseñas distintas. El problema confirmado fue de configuración
y autenticación, **no de datos duplicados**.

El escenario es coherente con credenciales locales diferentes apuntando al mismo
host/puerto/base: generar otro archivo de entorno no modifica la contraseña del
usuario ya persistido en PostgreSQL. Un fallo de autenticación no demuestra que
la ingesta haya duplicado eventos ni justifica borrar tablas para corregirlo.

No están disponibles en el repositorio o conversación visible el log redactado,
la fecha del incidente, los identificadores de ambas copias ni una captura de su
resolución. Por ello no se atribuye una reproducción independiente a Codex ni se
inventa un mensaje SQL o código de error concreto.

La mitigación verificable es el aislamiento documentado: proyecto/volumen propios,
puerto coherente con DB_PORT y credenciales correspondientes a la instancia elegida.
Cambiar solo contraseñas en otra copia no reinicializa usuarios del volumen.
**Pendiente humano:** adjuntar evidencia sin secretos y confirmar qué corrección
se aplicó efectivamente al incidente; no se presume su cronología respecto al commit.

## Iteración 5: configuración de GitHub Actions

**Objetivo.** Validar backend y frontend en push y pull request hacia dev/main.

**Instrucción original disponible, fragmento literal:**

> Quiero un pipeline sencillo, seguro y reproducible, adecuado para que el evaluador pueda revisar la calidad del proyecto.

**Archivo creado.** Solo [`.github/workflows/ci.yml`](../.github/workflows/ci.yml),
incorporado en `fa23c4e`. Dos jobs con Node 22, caché por lockfile, acciones fijadas
por SHA y permisos de lectura. Backend: npm ci, typecheck, test, build. Frontend:
npm ci y build de producción. No necesita secretos ni servicio PostgreSQL porque
las pruebas actuales sustituyen la persistencia.

**Validaciones observadas.** YAML parseado y comprobadas ramas, permisos, caché y
comandos. Instalación en copia sin entorno personal; 26 tests, typecheck y builds
correctos. Las comprobaciones locales de esa iteración usaron Node 24; el workflow
selecciona 22. La prueba Node 22 de instalación está en la iteración 4.

**Decisión humana y ejecución remota.** El desarrollador solicitó CI y el historial
registra su incorporación. En esta solicitud informa que GitHub Actions ejecutó
correctamente backend y frontend en `dev`: **resultado reportado por el desarrollador,
pendiente de evidencia remota adjunta**. No se pudo consultar directamente la página
de Actions y no hay una captura localizada. Tener `ci.yml` y tests locales verdes
no verifica por sí solo el resultado remoto.

**Para cerrar la evidencia:** añadir URL de la ejecución, SHA ejecutado, rama dev,
fecha real y captura donde ambos jobs aparezcan satisfactorios. No se inventa un
número de run ni se presupone que sea exactamente el SHA del último commit.

## Decisiones técnicas tomadas por el desarrollador

| Decisión trazable | Evidencia y límite de atribución |
|---|---|
| Analizar antes de editar y separar certeza de riesgo | Primer prompt y diagnóstico conservado. |
| Aprobar primero seguridad, validación y errores | Prompts y review-01/review-02. |
| Mantener transacciones, unicidad y actualización cronológica | Restricción explícita de implementación; repositorio actual. |
| Revisar migración antes de incorporarla | review-02 registra backup y ejecución humanos; falta log adjunto. |
| Reutilizar arquitectura en replay y no duplicar reglas | Prompt de replay, código y commit b03c040. |
| No entregar API_KEY a Angular | Restricción repetida; configuración y sesión independiente. |
| Separar reinicio de reproducción y borrado de datos | Contrato, instrucciones y motor/guía. |
| Probar una base independiente sin destruir la existente | Pedido de instalación y registro de prueba real. |
| Incorporar CI de lectura sin PostgreSQL innecesario | Pedido de CI y workflow. |
| Reservar revisión e incorporación a Git al desarrollador | Los pedidos excluyen commit/push automáticos; existen revisiones y commits posteriores. |

La elección concreta de cola serial, comparación temporal SQL, cookie de sesión
y agrupación de jobs fue propuesta/implementada durante la asistencia. La
existencia del código en Git no demuestra por sí sola aceptación individual de
cada detalle: este documento requiere aprobación final del desarrollador.

## Validaciones manuales y automatizadas

### Resultados oficiales y evidencia real

| Recorrido del fixture | Aceptados | Duplicados | Rechazados | Eventos persistidos | Vehículos | Alertas |
|---|---:|---:|---:|---:|---:|---:|
| Primera reproducción, base limpia | 20 | 2 | 2 | 20 | 8 | 4 |
| Segunda, sin limpiar | 0 | 22 | 2 | 20 | 8 | 4 |

Estos valores no se deducen solo de la expectativa: figuran en el
[oráculo oficial](../fixtures/expected_detailed.json), en pruebas con persistencia
simulada y en la ejecución real observada de la iteración 4. Los rechazos son
INVALID_LATITUDE e INVALID_SPEED; el evento tardío E-001-00 alerta sin sustituir
E-001-02. E-004-03 a 80 no alerta; E-005-03 a 81 sí.

### Alcance de cada validación

| Evidencia | Qué permite afirmar | Qué no acredita |
|---|---|---|
| 35 tests backend | Validación, HTTP/auth,transacciones,consultas, SSE, replay y configuración y transporte Http real mediante sockets,con persistencia simulada en las pruebas correspondientes| Concurrencia SQL real exhaustiva o UI E2E automatizada |
| Prueba aislada PostgreSQL | Persistencia, dos replays, orden de historial y estados con el motor real | Entrega durable SSE, varias instancias o carga de producción |
| Builds Angular | Compilación de aplicación y plantillas | Que se ejecutaron los tests del navegador |
| review-02/review-03 | Aprobaciones y comprobaciones manuales registradas | Existencia de capturas o logs no adjuntos |
| CI versionado | Definición reproducible de validaciones | Resultado de un run remoto sin enlace/captura |

La suite normal está en [backend/test](../backend/test). No se afirma que los
tests Angular estén aprobados: `app.component.spec.ts` conserva expectativas del
scaffold (`title` y texto inicial) que no corresponden al componente actual.
Es un pendiente constatado por inspección; no se ejecutó esa suite para este
documento ni se modificó dentro de esta tarea. CI construye Angular, no ejecuta Karma.

Comandos reproducibles desde la raíz, sin revelar configuración:

```powershell
npm.cmd --prefix backend run typecheck
npm.cmd --prefix backend test
npm.cmd --prefix backend run build
npm.cmd --prefix frontend run build -- --configuration production
```

Las salidas exitosas citadas proceden de las iteraciones visibles anteriores.
Para elaborar este documento se revisaron archivos y Git, sin volver a escribir
datos en PostgreSQL ni repetir ensayos destructivos.

## Problemas encontrados y soluciones

| Problema | Respuesta y evidencia |
|---|---|
| Ingesta rechazada antes de parsear JSON | Reordenar middlewares; pruebas HTTP, abae2f4. |
| Ingesta sin clave y errores poco útiles | Autenticación, errores JSON y motivos de dominio, abae2f4. |
| Identificadores recortados o limitados sin contrato | Preservar identidad y TEXT; revisión/migración registradas. |
| Riesgo de comparar fechas con pérdida de precisión JS | Comparación de igualdad en PostgreSQL; precisión restante documentada. |
| Publicaciones indebidas o antes del commit | Respetar booleanos del repositorio y publicar después; pruebas de duplicado y rollback. |
| Timers concurrentes y pausa con evento en vuelo | Cola serial, invalidación de timers y pausa confirmada al terminar el paso. |
| Arranque dependiente del directorio del entorno | Cargador raíz antes del pool y tests de ruta/configuración, c4b53ae. |
| Dos copias y contraseñas distintas contra una instancia | Diagnóstico humano: configuración/auth; aislamiento como mitigación, no limpieza de datos. |
| Error `uv_os_get_passwd` en sandbox al cargar tsx | Repetir fuera del sandbox con aprobación; health correcto, sin cambiar lógica. |

Las propuestas del diagnóstico no deben confundirse con decisiones ejecutadas.
Por ejemplo, el middleware actual bloquea ingesta con 503 si falta la clave del
servidor; no se implementó la sugerencia inicial de abortar todo el arranque.

## Riesgos identificados y estrategia de rollback

**Estado:** estrategia propuesta para revisión humana; no consta un simulacro
completo de rollback ni una transición productiva ejecutada.

| Riesgo | Mitigación actual o pendiente |
|---|---|
| Corrupción del estado por eventos tardíos/duplicados | Claves persistentes, comparación de payload y upsert temporal. Ampliar pruebas concurrentes reales. |
| Commit confirmado y aviso SSE perdido | Snapshot al conectar; evaluar outbox si se exige entrega durable. No prometer exactly-once. |
| Más de una instancia de replay/SSE | El diseño actual es local y de un proceso; coordinación distribuida pendiente. |
| Confundir configuración con corrupción de datos | Verificar destino y autenticación antes de actuar; no borrar para resolver credenciales. |
| Migración/esquema incompatible | Backup previo, comprobar versión y restricciones; no aplicar migraciones antiguas a esquema nuevo. |
| Exposición de credenciales o controles locales | Entorno excluido de Git, sesiones y loopback; revisión de seguridad antes de publicar en Internet. |
| Cobertura incompleta de frontend | Actualizar pruebas scaffold y añadir E2E; no equiparar build a pruebas funcionales. |

Rollback recomendado:

1. Pausar replay y detener la entrada de nuevos eventos de forma controlada;
   identificar la versión y la base afectadas sin registrar secretos.
2. Preservar la base y obtener un respaldo autorizado antes de cualquier cambio
   de esquema. Mantener la prueba separada del volumen de trabajo original.
3. Volver al último código conocido como válido mediante un procedimiento Git
   revisado, comprobando primero su compatibilidad con el esquema vigente.
   No ejecutar resets destructivos ni revertir tipos automáticamente.
4. Verificar health, cantidades, estados, historial e idempotencia en la instancia
   correcta antes de reabrir la ingesta.
5. Conservar los eventos ya confirmados y usar reintentos idempotentes. Restaurar
   datos solo con una decisión humana y un plan que contemple lo escrito después
   del backup. No reactivar el legacy defectuoso como escritor de las tablas modernas.

Reiniciar el replay o detener un contenedor no constituye rollback de datos.
Esta tarea documental no ejecutó ninguno de esos procedimientos.

## Conclusiones sobre el uso responsable de IA

La evidencia muestra un ciclo de diagnóstico, instrucciones acotadas, cambios
revisables, pruebas y aprobación humana. Codex ayudó a inspeccionar, implementar,
probar y documentar; el desarrollador fijó restricciones, revisó resultados y
decidió la incorporación. Los defectos heredados se conservaron como referencia
y los resultados se contrastaron con un oráculo independiente del código nuevo.

Los límites también forman parte de la evidencia: no se atribuyen prompts de
Angular que no están disponibles, un commit «E2E» no sustituye una prueba de
navegador y las pruebas simuladas no se presentan como PostgreSQL real. El incidente
de autenticación y el éxito remoto de CI se registran con su fuente humana, sin
inventar logs, fechas ni capturas. No se incluyen credenciales ni contenido del entorno.

### Pendientes antes de publicar

- [x] Corregir la diferencia entre replay integrado y transporte HTTP
  de la demo; validado mediante pruebas automatizadas y comprobación manual.
- [ ] Adjuntar URL/captura del run de Actions en dev, SHA y estado de ambos jobs.
- [ ] Adjuntar video/capturas de los dos replays, pausa/reanudación y dashboard;
  confirmar que no muestran configuración sensible.
- [ ] Confirmar el relato del incidente de dos copias y adjuntar log redactado,
  fecha y solución aplicada, sin contraseñas ni identificadores sensibles.
- [ ] Si se publicitan backup/migración como evidencia ejecutable, añadir un
  registro seguro o referencia a la comprobación humana de review-02.
- [ ] Aprobar la diferencia entre replay integrado y transporte HTTP de la demo,
  y reconocer los pendientes de tests Angular y rollback no ensayado.

Hasta completar esos puntos, este documento distingue evidencia técnica comprobada,
registros de revisión y afirmaciones pendientes de soporte publicable.

## Corrección posterior a la revisión humana: transporte HTTP del replay

El relato de las iteraciones 1 a 5 anterior conserva la implementación y evidencias
históricas hasta `fa23c4e`. Posteriormente, el desarrollador solicitó un análisis
de impacto sin modificaciones y aprobó expresamente sustituir la llamada directa
por HTTP para cumplir `docs/DEMO-REPLAY.md`. Esa aprobación resuelve la decisión
de transporte pendiente en la revisión; no se reescribe la historia como si la
implementación original ya hubiera usado HTTP.

**Cambio autorizado y realizado.** Nuevo adaptador exclusivo del backend,
`backend/src/services/replay-http-client.ts`, con fetch nativo, destino fijo
`127.0.0.1`, PORT del servidor y `POST /api/events/batch`. La cabecera X-API-Key
se toma del entorno del servidor. `ReplayService` lo usa como transporte
predeterminado, manteniendo su cola, timer, controles y contadores. El endpoint
existente sigue siendo el único responsable de validación, idempotencia,
persistencia y publicaciones SSE después de COMMIT. No se cambia Angular.

**Riesgos gestionados.** Timeout de 10 segundos para petición y cuerpo; rechazo
de redirecciones y respuestas incoherentes; errores técnicos sanitizados, sin
propagar cabeceras, claves ni mensajes arbitrarios. No hay reintentos automáticos.
Después de una respuesta perdida el resultado puede ser incierto: la reanudación
explícita conserva protección idempotente, pero puede contabilizar un duplicado.
Abortar HTTP no equivale a revertir PostgreSQL.

**Validación posterior.** Se conservan las 26 pruebas anteriores y se incorporan
9 pruebas en `backend/test/replay-http.test.cjs`: 35 aprobadas en la ejecución local
de esta corrección. Se verifica con sockets HTTP reales que el transporte por
defecto envía la cabecera y el cuerpo al endpoint protegido. Dos recorridos por
la ingesta real con repositorio simulado dan 20/2/2 y 0/22/2, sin nuevas publicaciones
SSE en el segundo; también se prueban pausa, reanudación, reinicio, stop, errores
HTTP, respuesta inválida, timeout, rechazo de redirecciones y rollback simulado.
La clave usada en pruebas es sintética. Los controles de sesión existentes se
conservan y siguen cubiertos por sus pruebas.

**Validación manual posterior al desarrollo.** Después de incorporar el transporte HTTP, se ejecutó FleetPulse desde Angular y se comprobó en los registros de Express que el inicio del replay mediante POST /api/replay/start generaba solicitudes reales a POST /api/events/batch, con respuestas HTTP 200. Se verificó el avance hasta completar los 24 eventos y que, al finalizar, dejaban de enviarse nuevas solicitudes de ingesta. Las consultas posteriores a GET /api/replay correspondían únicamente al seguimiento del estado.

Adicionalmente, se ejecutó npm test en el backend con 35 pruebas aprobadas, 0 fallidas y 0 omitidas. La compilación de producción del frontend mediante npm run build finalizó correctamente. Estas comprobaciones fueron realizadas manualmente por el desarrollador y no deben confundirse con una prueba E2E automatizada de navegador

**Límite de evidencia.**Las pruebas automatizadas del nuevo transporte HTTP utilizan conexiones HTTP reales, pero sustituyen la persistencia por un repositorio simulado en los casos correspondientes. La validación manual posterior confirmó el funcionamiento del transporte HTTP desde la aplicación, sin constituir una nueva prueba automatizada integral con PostgreSQL real.

La instalación y ejecución con PostgreSQL independiente se había verificado previamente para una versión anterior. Los cambios posteriores del transporte HTTP fueron revisados, compilados, probados y finalmente incorporados a GitHub por decisión del desarrollador. No se atribuye a Codex la ejecución manual ni el commit realizado por el desarrollador.
