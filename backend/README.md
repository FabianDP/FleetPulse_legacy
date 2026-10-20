# Ingesta: segunda iteración

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

Quedan pendientes integración con PostgreSQL real, migración verificada,
duplicados/conflictos concurrentes, replays completos y entrega de consultas,
stream, Angular y reproductor. Las pruebas con dobles no sustituyen esa evidencia.
