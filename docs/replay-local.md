# Replay progresivo local

## Integración y decisiones

`ReplayService` lee el fixture desde una ruta fija relativa al módulo, conserva
el orden de líneas y llama a `ingestBatch([evento])`. No hay un segundo validador
de telemetría ni SQL de replay. La autenticación HTTP de la ingesta sigue intacta.
Por la integración dentro del backend solicitada en esta iteración, el motor no
hace una petición HTTP a sí mismo: usa directamente el servicio existente.
La `API_KEY` del productor permanece en el servidor y no se entrega al navegador.

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
registra únicamente `INGESTION_FAILED`. Reanudar reintenta ese evento; si hubo un
commit de resultado incierto, la idempotencia existente protege la repetición.

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
   $env:REPLAY_ENABLED = 'true'
   $replayPassword = Read-Host 'Elija una contraseña local distinta de API_KEY' -AsSecureString
   $env:REPLAY_PASSWORD = [System.Net.NetworkCredential]::new('', $replayPassword).Password
   Set-Location backend
   npm.cmd run build
   npm.cmd start
   ```

   Esto solo configura el entorno de esa terminal; no edita `.env`. El arranque
   conserva la configuración de base ya existente. No mostrar contraseñas en video.

3. En otra terminal, desde la raíz:

   ```powershell
   Set-Location frontend
   npm.cmd start -- --host localhost --port 4200
   ```

4. Abrir `http://localhost:4200`. Pulsar **Autorizar controles locales**; en el
   diálogo nativo escribir usuario `replay` y la contraseña elegida. El backend
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

No se incluye reset ni migración en esta iteración. Para demostrar un primer replay
limpio hace falta una base de pruebas separada preparada previamente; no limpiar
la base actual para seguir estos pasos.

## Pruebas y límites

Desde `backend`: `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`.
Desde `frontend`: `npm.cmd run build`.

Los tests nuevos usan `node:test`, reloj simulado y dobles de persistencia:
orden, pausas, reanudación, reinicio, doble inicio, evento en vuelo, fallos,
autorización HTTP, expiración y dos replays del fixture con la ingesta existente.
La regresión de los dos replays espera 20/2/2 y 0/22/2 y ninguna emisión nueva
en la segunda ejecución. El repositorio simulado no acredita SQL ni concurrencia
en PostgreSQL. Las pruebas SSE preexistentes mantienen cobertura con conexiones
HTTP reales y rollback simulado. Ninguna de estas pruebas escribe en PostgreSQL.

Pendientes: verificar manualmente autorización y controles en un navegador y los
dos replays sobre una base de pruebas real. El build Angular verifica plantillas
y tipos, pero no es una prueba E2E. Replay y SSE son de una sola instancia; para
múltiples procesos harían falta coordinación compartida y notificaciones durables.
