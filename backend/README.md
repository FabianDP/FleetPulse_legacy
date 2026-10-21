# FleetPulse: ingesta, consultas y SSE

Para instalación limpia, variables raíz y PostgreSQL independiente seguir el
[README principal](../README.md). `npm start` y `npm run dev` cargan el `.env`
raíz antes de importar la aplicación; no se carga un `.env` personal en backend.

El replay progresivo y los controles Angular están documentados en
[Replay local](../docs/replay-local.md), con autorización, comandos y pruebas manuales.

Desde `backend`, ejecutar `npm run typecheck` y `npm test`.
En PowerShell con scripts deshabilitados, utilizar `npm.cmd`.
Las pruebas compilan TypeScript y usan `node:test`, sin dependencias nuevas.
Ejercitan HTTP real en loopback y sustituyen el acceso a PostgreSQL por dobles;
no cargan `.env`, no escriben en la base ni verifican concurrencia real.

## Seguridad y errores

Configurar `API_KEY` en el entorno del servidor y del futuro reproductor.
Enviar esa clave mediante `X-API-Key` exclusivamente a la ingesta.
No incluirla en Angular, logs ni repositorio. Si falta la configuración del
servidor, la ingesta queda bloqueada con 503 `AUTH_NOT_CONFIGURED`.
Con configuración disponible, una cabecera ausente devuelve 401 y una clave
incorrecta 403. La comparación utiliza hashes de longitud fija y tiempo constante.

CORS y el parser preceden a las rutas. JSON malformado devuelve 400
`INVALID_JSON`; un cuerpo superior a 1 MB devuelve 413 `PAYLOAD_TOO_LARGE`.
El parser se ejecuta antes de autenticar: esos errores de transporte tienen
precedencia sobre la clave. Los errores internos devuelven un 500 genérico.
Los lotes deben contener entre 1 y 1000 elementos; un lote vacío devuelve 400.

## Identidad, validación y tiempo

Los identificadores son strings no vacíos, sin recorte ni normalización. No se
impone un máximo arbitrario de 100 caracteres. Los campos adicionales se ignoran:
la identidad del payload se determina por los siete campos del modelo oficial.
Cuando hay varios errores en un evento, se informa el primero según el orden
del esquema. Los motivos incluyen `INVALID_LATITUDE`, `INVALID_SPEED` y
`EVENT_ID_CONFLICT`; los índices son relativos al lote recibido.

Se mantiene la validación ISO con zona mediante Zod. Las fechas equivalentes
con offsets distintos se comparan por instante. La igualdad temporal de un
evento existente se resuelve en PostgreSQL con un parámetro `timestamptz`, sin
convertir su valor a `Date` ni truncarlo a milisegundos en JavaScript.
La precisión persistida sigue siendo la de PostgreSQL (microsegundos): fracciones
más precisas pueden redondearse y requieren una decisión de contrato futura.

La clave primaria resuelve la inserción concurrente mediante
`ON CONFLICT DO NOTHING`. Si no se inserta, se consulta y compara el original:
payload igual es duplicado; distinto es conflicto sin sobrescritura. Se mantienen
las transacciones por evento y el upsert cronológico con desempate por `eventId`.
Ante un fallo técnico posterior, los eventos ya confirmados del lote permanecen
persistidos; se puede reintentar usando la idempotencia.

## Esquema y migración pendiente

`database/schema.sql` usa `TEXT` para identificadores en instalaciones nuevas.
`CREATE TABLE IF NOT EXISTS` no actualiza tablas existentes. Para ellas se
incluye `database/migrations/002-identifiers-text.sql`, que debe revisarse y
aplicarse en una ventana de mantenimiento: conserva filas y restricciones,
pero requiere bloqueos de tablas. No se ejecuta automáticamente ni desde tests.
Hasta aplicarla, una base con `VARCHAR(100)` sigue rechazando IDs más largos.
`TEXT` tampoco elimina los límites físicos de los índices de PostgreSQL;
identificadores excepcionalmente grandes requieren un diseño adicional.

## Consultas del dashboard

Todas las consultas devuelven arrays JSON con nombres camelCase.
Las fechas se serializan en UTC conservando microsegundos. No hay paginación
en esta iteración, por lo que historiales muy grandes requieren trabajo posterior.

| Endpoint | Filtros opcionales | Orden |
|---|---|---|
| `GET /api/vehicles` | `search`: subcadena literal sin distinguir mayúsculas; `vehicleId`: exacto; `status`: `OFF`, `MOVING`, `STOPPED` | `vehicleId ASC` |
| `GET /api/vehicles/:vehicleId/events` | Ninguno | `observedAt ASC, eventId ASC` |
| `GET /api/alerts` | `vehicleId`: exacto; `type`: `OVERSPEED` | `observedAt DESC, eventId ASC` |

Los filtros se combinan con AND. El historial de un vehículo desconocido devuelve
200 con `[]`, una de las alternativas permitidas por el contrato. Valores vacíos,
parámetros repetidos, nombres desconocidos y enums inválidos devuelven 400
`INVALID_QUERY`; una ruta con escape inválido devuelve 400 `INVALID_PATH`.
El contrato común exige búsqueda por vehículo pero no fija filtros especializados
ni orden de alertas; no hay otro requisito especializado en este repositorio.
Los filtros adicionales y el orden de alertas anteriores son decisiones de esta API.
Las alertas incluyen todos los datos del evento histórico, `id` como string,
`type` y `createdAt`. Los vehículos incluyen los siete campos del evento y `status`.

## Stream local y seguridad

El servidor escucha exclusivamente en `127.0.0.1`. Consultas y SSE permiten
conexiones loopback sin Origin (CLI local) o con Origin exactamente
`http://localhost:4200`. IP remota u otro Origin reciben 403. CORS permite ese
origen Angular; no concede acceso de escritura sin `X-API-Key`.
No se usa la clave del productor en Angular, URLs ni `EventSource`.
Este control es para una demo local, no sustituye autenticación de usuarios:
no publicar mediante túneles o proxies. Una publicación futura debe añadir
autenticación de sesión para lecturas/SSE y revisar la política de origen.

Abrir `new EventSource('http://127.0.0.1:3000/api/stream')` desde Angular en
`http://localhost:4200`. Registrar listeners con `addEventListener` para
`vehicle.updated` y `alert.created`. Cada mensaje incluye `type`, `eventId`,
`vehicleId`, `observedAt` y `data`: el estado completo para vehículo, o el evento
con `type: 'OVERSPEED'` para alerta. La alerta SSE se identifica por `eventId`;
su identificador SQL y `createdAt` se obtienen del snapshot de alertas.

Se envían comentarios heartbeat cada 15 segundos y una sugerencia de reintento
de 3 segundos. Los comentarios no son eventos de dominio. Se eliminan suscriptores
y temporizadores al desconectar; clientes lentos se desconectan para evitar
acumular memoria. SIGINT/SIGTERM cierra streams antes de cerrar servidor y pool.

Los mensajes se publican después de COMMIT y liberar la conexión. Se respetan
los booleanos devueltos por el repositorio: un evento tardío puede emitir solo
`alert.created`. Duplicados, conflictos, inválidos y rollback no publican.
El transporte es en memoria y para un único proceso; no hay replay ni garantía
durable de entrega. Una caída entre COMMIT y publicación puede perder el aviso.
Al abrir/reconectar, recuperar snapshots GET y continuar con el stream; el cliente
debe reconciliar por eventId y comparar instante/desempate antes de reemplazar
estados, también ante publicaciones concurrentes. En producción, evaluar outbox
y distribución entre instancias si se requiere entrega fiable.

Las pruebas verifican HTTP, dos clientes SSE, heartbeat, limpieza, backpressure,
validación de consultas, parámetros SQL y cláusulas de orden, más ausencia de
emisiones ante duplicados y rollback (incluido COMMIT fallido). No ejecutan el
ORDER BY en PostgreSQL real ni sustituyen pruebas de integración. Quedan pendientes
la migración verificada, concurrencia real, revalidación de los dos replays sobre
esta versión sobre PostgreSQL real y pruebas E2E de Angular. El reproductor local
ya reutiliza la ingesta existente. No se han alterado los datos existentes.
