# Replay progresivo local

## Integración y decisiones

`ReplayService` lee el fixture desde una ruta fija relativa al módulo y conserva
el orden de líneas. Su adaptador backend usa fetch nativo de Node 22 para enviar
`{"events":[evento]}` a `http://127.0.0.1:<PORT>/api/events/batch`, donde PORT es el
del servidor (3000 por defecto). Adjunta X-API-Key desde `process.env.API_KEY`.
El endpoint existente autentica y llama a `ingestBatch`: no hay un segundo
validador de telemetría ni SQL de replay. La clave no se envía a Angular, respuestas
de control o logs. No se necesita una variable de URL ni dependencia nueva.

El destino es fijo en loopback y las redirecciones se rechazan. El timeout de
10 segundos cubre petición y lectura de respuesta; no hay reintentos automáticos.
Solo una respuesta HTTP 200 con estructura y contadores coherentes actualiza el
progreso. Se valida el formato de respuesta, no se replican reglas de telemetría.
Los motivos de dominio permitidos se reconocen explícitamente; si el endpoint
incorpora nuevos motivos, debe actualizarse ese contrato de respuesta del adaptador.

El control utiliza una contraseña independiente `REPLAY_PASSWORD`, habilitación
explícita `REPLAY_ENABLED=true`, acceso loopback y una sesión aleatoria HttpOnly.
El login ocurre por navegación al backend y autenticación Basic nativa del
navegador, fuera de Angular. Usuario: `replay`. No escribir credenciales en URLs,
grabaciones ni código. La cookie es SameSite=Strict, restringida a `/api/replay`
y expira en cuatro horas. Un nuevo login reemplaza la sesión anterior. No lleva
Secure porque la demo usa HTTP exclusivamente sobre loopback; no publicar este
mecanismo por Internet, túneles o proxies. CORS con credenciales solo admite
`http://localhost:4200`; ni CORS ni Origin sustituyen la sesión.

Los comandos y cada paso de ingesta comparten una cola serial. Se usa un único
setTimeout después de completar cada evento, con una generación que invalida
timers antiguos. El intervalo es el tiempo de espera entre pasos (más la latencia
de ingesta), de 100 a 60000 ms, 750 por defecto. El primer evento espera también
ese intervalo. No hay ejecuciones simultáneas en una misma instancia.
Pausar o reiniciar esperan el evento en vuelo: su transacción no se cancela.
Después de responder a Pausar no comienzan eventos adicionales.

Reiniciar pone índices, contadores y errores a cero y deja el motor en `idle`;
hay que pulsar Iniciar. Nunca borra PostgreSQL. Reiniciar el proceso Node pierde
el progreso y las sesiones, pero no datos. Un rechazo de validación cuenta y
continúa. Un fallo técnico deja `error`, mantiene el índice para reintento y
registra un código seguro: `REPLAY_HTTP_CONFIG_ERROR`, `REPLAY_HTTP_AUTH_ERROR`,
`REPLAY_HTTP_ERROR`, `REPLAY_HTTP_TIMEOUT`, `REPLAY_HTTP_UNAVAILABLE` o
`REPLAY_HTTP_INVALID_RESPONSE`. Otros fallos internos conservan `INGESTION_FAILED`.
No se propagan excepciones, cabeceras ni cuerpos de error arbitrarios del servidor.
Los rechazos y conflictos recibidos dentro de una respuesta válida 200 sí cuentan
como rechazados y permiten continuar con el siguiente evento.

Reanudar después de un error vuelve a intentar explícitamente el mismo índice.
Un timeout o aborto HTTP no garantiza rollback: PostgreSQL podría haber confirmado
antes de perderse la respuesta y SSE ya podría haberse emitido. La idempotencia
protege la repetición, pero ese reintento puede contarse como duplicado y cambiar
los contadores observados respecto de un recorrido sin fallos de transporte.
Pausa y apagado normal esperan el paso en curso; el cierre mantiene el orden de
detener replay antes de cerrar el listener y el pool. El timeout limita la espera
del cliente HTTP, no garantiza que una consulta SQL bloqueada finalice.

Las actualizaciones del dashboard siguen llegando por el SSE existente, después
de COMMIT. El componente consulta el progreso cada 750 ms, sin cambiar la tabla,
indicadores, alertas o historial. Esa consulta no dispara cargas del dashboard.

## Endpoints

Todos requieren demo habilitada y acceso local. Salvo login, requieren cookie
de sesión válida; una cabecera Origin permitida por sí sola no autoriza.

| Método y ruta | Cuerpo | Efecto |
|---|---|---|
| `GET /api/replay/login` | Autenticación Basic del navegador | Crea sesión y redirige al dashboard |
| `GET /api/replay` | Ninguno | Progreso actual |
| `POST /api/replay/start` | `{ "intervalMs": 750 }` opcional | Inicia solo desde idle |
| `POST /api/replay/pause` | `{}` | Pausa después del evento en vuelo |
| `POST /api/replay/resume` | `{ "intervalMs": 750 }` opcional | Continúa desde paused o error |
| `POST /api/replay/restart` | `{ "intervalMs": 750 }` opcional | Reinicia progreso sin borrar datos |

Respuestas: progreso con `processed`, `total`, `accepted`, `duplicates`,
`rejected`, `intervalMs`, `state`, `errors`. Índices de error desde cero relativos
al fixture completo; la UI muestra líneas desde uno. Los errores técnicos son
intentos fallidos, no aumentan processed ni rejected. Comando incompatible: 409;
intervalo/cuerpo inválido: 400; sesión ausente/expirada: 401; credenciales incorrectas
u origen/IP no permitido: 403; demo deshabilitada o fixture inaccesible: 503.

## Prueba manual sin borrar datos

1. Conservar PostgreSQL y su configuración actual. Si hay un backend anterior
   ocupando el puerto 3000, detenerlo normalmente con Ctrl+C antes de continuar.
2. En una terminal PowerShell desde la raíz del repositorio:

   ```powershell
   npm.cmd --prefix backend run build
   npm.cmd --prefix backend start
   ```

   Primero preparar el `.env` raíz según el [README principal](../README.md).
   `node scripts/setup-env.cjs` solo lo crea si no existe. No depende de variables
   exportadas en la terminal; la contraseña del login es REPLAY_PASSWORD de ese
   archivo. No mostrarla en video. Para una base nueva usar el Compose y volumen
   independientes documentados en el README, nunca limpiar la base existente.

3. En otra terminal, desde la raíz:

   ```powershell
   npm.cmd --prefix frontend start -- --host localhost --port 4200
   ```

4. Abrir `http://localhost:4200`. Pulsar **Autorizar controles locales**; en el
   diálogo nativo escribir usuario `replay` y REPLAY_PASSWORD. El backend
   redirige al dashboard; el componente muestra Listo y 0 de 24. Usar `localhost`
   en ambos orígenes, sin mezclarlo con `127.0.0.1` para las cookies del navegador.
5. Dejar 750 ms y pulsar **Iniciar**. Verificar avance gradual y actualizaciones
   por SSE. Pulsar **Pausar**, esperar su confirmación y comprobar que processed
   permanece estable. Cambiar intervalo si se desea y pulsar **Reanudar**.
6. Al completar, revisar los rechazos de líneas 22 y 23 y sus motivos. Si la base
   no contenía eventos del fixture, se esperan 20 aceptados, 2 duplicados y
   2 rechazados; evento tardío genera alerta, velocidad 80 no la genera y 81 sí.
7. Pulsar **Reiniciar** y luego **Iniciar**, sin limpiar la base: esperar 0 aceptados,
   22 duplicados y 2 rechazados, sin nuevas emisiones SSE por duplicados. Si el
   fixture ya estaba completo antes del paso 5, ambos recorridos tendrán esos
   contadores. Datos de demostraciones ajenas al fixture permanecen en el dashboard
   y pueden elevar sus totales; no se borran para esta prueba.
8. Dos pestañas comparten el motor. Intentar iniciar simultáneamente no crea dos
   loops: un comando obtiene éxito y el incompatible 409. Verificar que al cerrar
   un componente no continúa su polling; el replay del servidor continúa hasta
   pausa, finalización o apagado normal del servidor.

No se incluye reset ni migración automática. Para demostrar un primer replay limpio,
el Compose del README prepara una base separada con su propio volumen y el esquema
actual; no limpiar la base existente para seguir estos pasos.

## Pruebas y límites

Desde `backend`: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`.
Desde `frontend`: `npm.cmd run build`.

Los tests nuevos usan `node:test`, reloj simulado y dobles de persistencia:
orden, pausas, reanudación, reinicio, doble inicio, evento en vuelo, fallos,
autorización HTTP, expiración y dos replays del fixture con la ingesta existente.
Se conservan esas pruebas y se añade `backend/test/replay-http.test.cjs`: fetch
real, endpoint Express protegido, clave sintética, fixture completo en orden,
dos recorridos, pausa/reanudación/reinicio, timeout durante lectura, autenticación,
redirecciones, respuestas inválidas, conexión fallida y rollback simulado.
La regresión de los dos replays espera 20/2/2 y 0/22/2 y ninguna emisión nueva
en la segunda ejecución. El repositorio simulado no acredita SQL ni concurrencia
en PostgreSQL. Las pruebas SSE preexistentes mantienen cobertura con conexiones
HTTP reales y rollback simulado. Ninguna de estas pruebas escribe en PostgreSQL.

La versión previa a la corrección de transporte sí tiene un ensayo PostgreSQL
real registrado en `delivery-verification.md`; no acredita el adaptador nuevo.
Para esta corrección no se ha ejecutado PostgreSQL real ni se ha creado una base.
Pendientes: verificar manualmente autorización y controles en un navegador y
repetir ambos replays HTTP en una base independiente autorizada. El build Angular verifica plantillas
y tipos, pero no es una prueba E2E. Replay y SSE son de una sola instancia; para
múltiples procesos harían falta coordinación compartida y notificaciones durables.
