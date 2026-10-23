La implementación moderna tiene una base de persistencia bien planteada, pero **todavía no cumple el contrato de extremo a extremo**. Los bloqueos principales son el orden de los middlewares, la ausencia de `X-API-Key`, las API de consulta y tiempo real faltantes, y la ausencia de pruebas automatizadas.

No modifiqué archivos. Revisé los diez solicitados y, para verificar persistencia y arranque, también el esquema SQL, configuración, servidor, `package.json`, README y requisitos del replay.

**Hallazgos comprobados en el legacy**

Ejecuté `legacy/ingest.js` con los 24 eventos originales, conservando su orden de llegada:

| Resultado | Legacy | Contrato |
|---|---:|---:|
| Historial tras primer replay | 24 | 20 |
| Alertas tras primer replay | 6 | 4 |
| Historial tras segundo replay | 48 | 20 |
| Alertas tras segundo replay | 12 | 4 |

Los defectos están en [legacy/ingest.js](/F:/FleetPulse/legacy/ingest.js:6):

| Defecto comprobado | Impacto | Solución recomendada |
|---|---|---|
| Guarda todos los registros sin validarlos. | Persiste eventos inválidos y permite que corrompan el estado actual: `VEH-006` termina con `E-006-03` y `VEH-007` con `E-007-03`. | Validar cada evento antes de cualquier efecto y devolver rechazo con índice y motivo. |
| No identifica duplicados ni conflictos de `eventId`. | Cada replay incrementa historial y alertas; un mismo identificador con payload distinto no produce conflicto explícito. | Unicidad persistente y comparación del payload cuando el identificador existe. |
| Asigna el último estado por llegada. | Un evento tardío puede reemplazar uno más reciente. `E-001-00` provoca esa regresión durante el replay, aunque el duplicado posterior `E-001-02` la oculta en el resultado final. | Actualización condicional por instante y desempate determinista. |
| Usa `speedKph >= 80`. | Crea una alerta indebida para `E-004-03`, que tiene exactamente 80 km/h. | Usar estrictamente `> 80`. |
| Solo mantiene estado en memoria y no calcula `OFF/MOVING/STOPPED`. | No ofrece persistencia entre procesos ni el modelo de estado requerido. | Persistencia transaccional y cálculo explícito del estado. |

**Implementación actual frente al contrato**

Los siguientes son hallazgos comprobados por lectura del código; señalo expresamente donde falta verificación ejecutable.

| Criticidad | Hallazgo y evidencia | Impacto | Recomendación |
|---|---|---|---|
| **P0 — bloqueante** | En [app.ts:8](/F:/FleetPulse/backend/src/app.ts:8), el router se monta antes de `express.json()` y CORS. | En el flujo normal, el endpoint valida `req.body` sin parsear y devuelve `400 INVALID_BATCH` para un lote JSON válido. Las respuestas del router tampoco reciben el middleware CORS posterior. | Montar los middlewares comunes antes de las rutas. |
| **P0 — seguridad** | No existe comprobación de `X-API-Key` en [event.routes.ts](/F:/FleetPulse/backend/src/routes/event.routes.ts:7) ni en `app.ts`. | Incumple el caso `AUTH_FAILURE`. Cuando se corrija el parser, la ingesta quedará disponible sin autenticación. | Middleware que contraste la cabecera con una variable de entorno; ausencia o clave incorrecta deben producir 401/403 antes de ingresar datos. Fallar al arrancar si falta la configuración obligatoria. |
| **P0 — funcionalidad** | La aplicación solo registra ingesta y health. | Faltan `GET /api/vehicles`, búsqueda, historial por vehículo, `GET /api/alerts` y stream. No puede demostrarse el contrato completo desde la API. | Implementar consultas y documentar respuesta para vehículos desconocidos. Ordenar historial por `observedAt ASC, eventId ASC`. |
| **P0 — tiempo real** | [event.service.ts:92](/F:/FleetPulse/backend/src/services/event.service.ts:92) ignora los booleanos de actualización de estado y creación de alerta; no hay publicación de mensajes. | No se emiten `vehicle.updated` ni `alert.created`. | Recoger los cambios y emitir después del commit. Un evento tardío puede generar únicamente `alert.created`. |
| **P0 — validación** | El esquema admite identificadores sin longitud máxima, pero PostgreSQL usa `VARCHAR(100)`. | Un identificador de 101 caracteres pasa Zod y falla en SQL; produce 500 y aborta los eventos restantes del lote. | Alinear contrato, validador y almacenamiento: ampliar las columnas si no se quiere restringir el contrato, o documentar y validar un límite acordado. |
| **P0 — errores** | Todos los errores de validación se devuelven como `INVALID_EVENT` en [event.service.ts:57](/F:/FleetPulse/backend/src/services/event.service.ts:57). | No coincide literalmente con el oráculo detallado, que espera `INVALID_LATITUDE` e `INVALID_SPEED`; reduce el diagnóstico del reproductor. | Mapear los errores de Zod a motivos de dominio estables y conservar índice y `eventId`. |
| **P0 — errores HTTP** | No hay manejador JSON global de errores. El router rechaza antes de alcanzar el parser. | JSON malformado recibe actualmente un error de lote, sin detectar la sintaxis. Al corregir el orden, la respuesta quedaría a cargo del manejador predeterminado de Express. | Manejar explícitamente JSON inválido, cuerpo excesivo y errores internos; responder JSON sin stack ni secretos. |
| **P0 — evidencia** | No encontré pruebas, script `test`, frontend, reproductor ni configuración de CI entre los archivos del repositorio. README contiene únicamente una descripción mínima. | No hay evidencia reproducible para gran parte de los criterios de evaluación. | Añadir pruebas, replay controlable, documentación de ejecución y CI; demostrar Angular y dos clientes simultáneos. |

**Protecciones actuales correctas**

No sería correcto atribuir a la implementación moderna los mismos problemas de concurrencia del legacy:

- [schema.sql:5](/F:/FleetPulse/backend/database/schema.sql:5) define `event_id` como clave primaria global.
- [event.repository.ts:35](/F:/FleetPulse/backend/src/repositories/event.repository.ts:35) usa `ON CONFLICT DO NOTHING`: la base decide quién inserta, evitando una comprobación previa vulnerable a carreras.
- Si no se inserta, el servicio consulta el registro y distingue duplicado de `EVENT_ID_CONFLICT`, sin sobrescribirlo.
- Evento, estado y alerta se escriben en una misma transacción por evento.
- El estado se actualiza mediante un *upsert* condicional por fecha y, en empate, por `eventId`. No depende de una lectura previa del estado.
- `TIMESTAMPTZ` permite comparar instantes reales; se conservan eventos antiguos.
- Las alertas usan `> 80`, se generan también para eventos tardíos y tienen unicidad persistente por evento.
- Zod comprueba tipos sin coerción, números finitos, rangos, velocidad no negativa y booleano. El lote admite 1–1000 elementos y procesa individualmente los registros inválidos.
- Las consultas utilizan parámetros SQL.

Estas protecciones están presentes en el código y el esquema revisados. **No ejecuté pruebas contra PostgreSQL que acrediten su comportamiento concurrente ni confirmé que la base activa tenga ese esquema aplicado.**

**Riesgos potenciales y decisiones pendientes**

| Riesgo potencial | Archivos involucrados | Impacto y tratamiento recomendado |
|---|---|---|
| Pérdida de precisión temporal. | `event.service.ts:26`, `event.validator.ts:5` | `sameEvent()` compara mediante `Date`, con precisión de milisegundos. Fechas distintas dentro del mismo milisegundo podrían considerarse iguales aunque PostgreSQL conserve más precisión. Definir precisión temporal y comparar con la misma representación en validación, almacenamiento e idempotencia. |
| Normalización implícita de identificadores. | `event.validator.ts:8–9` | `.trim()` transforma identificadores antes de persistir: `" E-1 "` y `"E-1"` colisionan. El contrato no define esa equivalencia. Documentarla o validar sin modificar la identidad recibida. |
| Rechazo de propiedades adicionales. | `event.validator.ts:15,19` | `.strict()` añade una política no expresada explícitamente en el contrato. Puede ser apropiada, pero debe documentarse y probarse para evitar incompatibilidades con productores. |
| Fallo técnico tras commits parciales. | `event.service.ts:95–99` | Si un evento posterior falla en SQL, los anteriores permanecen confirmados, pero el cliente recibe un 500 sin resumen parcial. Documentar esa semántica y el reintento idempotente; evitar presentar el lote como una transacción global. |
| Saturación del servicio. | `event.service.ts:64`, `config/database.ts` | Hay límites de cuerpo y lote, pero no controles de frecuencia o presión de entrada. Muchas peticiones pueden acumular espera del pool. Evaluar límites por cliente, tiempos máximos y métricas según la exposición real. |
| Exposición de la API. | `server.ts` | `listen(port)` no restringe explícitamente a loopback. La accesibilidad externa depende de red y firewall; no está demostrada. Para la demo local, enlazar a `127.0.0.1` o aplicar control equivalente. CORS no sustituye autenticación. |
| Integridad ante otros escritores. | `database/schema.sql` | Hay claves foráneas, pero no garantizan que todos los campos duplicados de estado/alertas correspondan al mismo evento. El repositorio actual los escribe coherentemente; scripts externos podrían romper esa relación. Restringir escrituras y evaluar restricciones adicionales. |

No inspeccioné valores de `.env` ni hay evidencia suficiente para afirmar filtración de secretos. `.gitignore` excluye `.env`, pero eso por sí solo no acredita que nunca se haya versionado.

**Pruebas necesarias para la evaluación**

| Grupo | Casos y aserciones imprescindibles |
|---|---|
| Dos replays | Primero: `20/2/2`, 20 eventos, 8 vehículos y 4 alertas. Segundo, sin reset: `0/22/2`, con las mismas cantidades persistidas. Comparar también identidades del oráculo. |
| Regresiones legacy/moderno | Demostrar rechazo de inválidos, idempotencia, conservación del estado ante eventos tardíos y ausencia de alerta a 80. El legacy debe fallar y el moderno pasar. |
| Conflictos | Mismo identificador y mismo payload: duplicado. Cambiar cada campo del payload: conflicto explícito, sin modificar original, estado ni alertas. |
| Concurrencia real | Dos solicitudes con el mismo evento: exactamente una aceptación. Repetir con sobrevelocidad: una sola alerta. Mismo identificador y payload distinto: un ganador y un conflicto. Eventos distintos del mismo vehículo: prevalece el mayor instante. |
| Tiempo | Offsets equivalentes, fechas sin zona, fechas imposibles, empate con desempate por `eventId` y fracciones submilisegundo. |
| Validación parcial | Mezclar válidos, inválidos, duplicados y conflictos. Verificar continuación, contadores, índices relativos al lote y motivos. Probar límites geográficos, tipos incorrectos, `null`, campos faltantes e identificadores largos. |
| HTTP y seguridad | Clave ausente/incorrecta/correcta; JSON malformado; cuerpo mayor de 1 MB; lote vacío o mayor de 1000; errores sin stack ni secretos; CORS del origen autorizado. |
| Atomicidad | Forzar fallo en estado o alerta y comprobar rollback completo de ese evento. Verificar recuperación mediante reintento tras un lote parcialmente confirmado. |
| Consultas y stream | Historial ordenado, búsqueda, alertas históricas y vehículo desconocido. Dos clientes reciben cambios; duplicados e inválidos no notifican; evento tardío alerta sin reemplazar estado. |
| Reproductor y entrega | Orden original, pausa/reanudación/reinicio, clave desde entorno, reset solo local, CI, comandos reproducibles y evidencia de revisión humana del trabajo agéntico. |

Los casos adversariales deben ejecutarse independientemente del fixture original, como indica su propio archivo.

**Orden recomendado de intervención**

1. **P0 inmediato:** corregir orden de middlewares, añadir autenticación y normalizar errores HTTP.
2. **P0 datos:** resolver longitudes de identificadores, motivos del oráculo y semántica temporal; verificar concurrencia y atomicidad con PostgreSQL real.
3. **P0 contrato completo:** consultas, stream, Angular y reproductor con dos replays.
4. **P0 entrega:** regresiones legacy/moderno, CI, README, video y plan de transición.
5. **P1:** observabilidad, control de carga y optimizaciones justificadas por mediciones.

Para la transición, recomiendo validar la nueva ingesta en almacenamiento aislado con los fixtures, contrastar estados y alertas y después cambiar el productor. El rollback debe preservar los eventos aceptados y evitar reactivar el legacy como escritor sobre las tablas modernas.

La comprobación estática `npm.cmd run typecheck` **pasó**. La ejecución HTTP del backend no pudo completarse por problemas del entorno de carga; por ello, los hallazgos de API están sustentados en el flujo del código, no en respuestas HTTP observadas.