# FleetPulse

Telemetría GPS: Node.js/TypeScript, PostgreSQL, Angular 19, SSE y replay local.

## Requisitos

Git, Docker Desktop iniciado con contenedores Linux, Compose v2.20+, Node.js
**22.x** y npm **10+**. `.nvmrc` selecciona Node 22, compatible con Angular 19.2
según su [tabla oficial](https://angular.dev/reference/versions). No instalar CLI
Angular global: los lockfiles incluyen las herramientas de cada proyecto.
Puertos locales: 3000, 4200 y 5434 (PostgreSQL, configurable).

## Instalación desde cero — PowerShell

Clonar la URL del repositorio entregado y situarse en su raíz. Ejecutar:

```powershell
node --version
npm.cmd --version
docker compose version
node scripts/setup-env.cjs
npm.cmd --prefix backend ci
npm.cmd --prefix frontend ci
```

El generador crea `.env` con tres credenciales locales independientes, sin
imprimirlas. Si ya existe `.env`, falla sin leerlo ni sobrescribirlo: revisarlo
manualmente o usar otro clon para la demo. Alternativa manual: copiar `.env.example`
solo si no existe `.env` y completar DB_PASSWORD, API_KEY y REPLAY_PASSWORD con
valores locales distintos y no vacíos. No usar configuración personal ni secretos
de producción. `.env` permanece excluido de Git.

Continuar con [Base limpia de demostración](#base-limpia-de-demostración-sin-borrar-datos),
el único procedimiento de arranque de PostgreSQL y backend. Después, en otra terminal:

```powershell
npm.cmd --prefix frontend start -- --host localhost --port 4200
```

Abrir **http://localhost:4200** después de verificar health según ese procedimiento.
Para desarrollo, sustituir el arranque backend
por `npm.cmd --prefix backend run dev`; no ejecutar start y dev simultáneamente.
Desde `backend`, `npm start` y `npm run dev` cargan el mismo archivo raíz.

En bash/zsh los comandos son iguales cambiando `npm.cmd` por `npm`; para health:
`curl --fail http://localhost:3000/api/health`. Con nvm, ejecutar `nvm use` antes
de instalar. No se necesitan variables previamente exportadas en la terminal.

## Entorno y PostgreSQL independiente

El backend carga el `.env` **de la raíz**, antes del pool, desde `src` o `dist`,
sin depender del directorio de ejecución. No carga un `.env` dentro de backend.
Variables exportadas explícitamente mantienen precedencia: usar una terminal
nueva sin DB_*, API_KEY, PORT o REPLAY_* heredadas para reproducir la demo.

| Variable | Uso |
|---|---|
| DB_HOST | `127.0.0.1`; Node corre fuera de Docker |
| DB_PORT | `5434`; cambiarlo si está ocupado |
| DB_USER / DB_NAME | `fleetpulse_demo`, iguales para Compose y backend |
| DB_PASSWORD | Contraseña local generada, obligatoria en Compose |
| PORT | `3000`; Angular y el login usan este puerto |
| API_KEY | Protege POST /api/events/batch; nunca va a Angular |
| REPLAY_ENABLED | `true` habilita la demo; `false` bloquea controles |
| REPLAY_PASSWORD | Contraseña independiente del login de replay |

`DATABASE_URL` no se consume. No mostrar `.env` en logs, capturas ni video.

Utilizar siempre **`-f compose.yaml -p $demoProject`**: el proyecto dinámico del
procedimiento siguiente utiliza el servicio `db` y su propio volumen. No reutiliza el contenedor
`fleetpulse-postgres` ni su volumen. `docker-compose.yml` se conserva como archivo
histórico; no combinar ambos Compose. PostgreSQL se publica solo en localhost.

En volumen vacío se ejecuta **solo** `backend/database/schema.sql`, montado de
solo lectura como `001-schema.sql`. Orden revisado: eventos, estado, alertas,
índices. Ya usa IDs TEXT. La migración `002-identifiers-text.sql` es para bases
antiguas VARCHAR(100), no se aplica sobre la instalación nueva. Cambiar `.env`
no cambia usuarios persistidos ni vuelve a ejecutar la inicialización SQL.

### Base limpia de demostración sin borrar datos

Desde la raíz, con Docker Desktop iniciado y el `.env` ya preparado, abrir una
terminal PowerShell nueva. Conservar ese archivo: Compose y backend deben usar
las mismas credenciales. No generar otro entorno para conectarse a una base previa.
Si hay un backend en el puerto 3000, detenerlo normalmente con Ctrl+C antes de
continuar; no detener ni modificar su PostgreSQL.

Elegir un proyecto nuevo en cada demostración y un puerto libre. Los valores de
DB_HOST/DB_PORT de esta terminal prevalecen sobre `.env` tanto en Compose como
en el backend; no se modifica ningún archivo de configuración:

```powershell
$demoProject = 'fleetpulse-demo-' + [guid]::NewGuid().ToString('N')
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '55434'
if (Get-NetTCPConnection -State Listen -LocalPort ([int]$env:DB_PORT) -ErrorAction SilentlyContinue) {
    throw 'Puerto ocupado: elija otro DB_PORT libre antes de continuar.'
}
docker compose -f compose.yaml --env-file .env -p $demoProject up -d --wait --wait-timeout 90
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL no esta listo; no iniciar el backend.' }
docker compose -f compose.yaml --env-file .env -p $demoProject ps
npm.cmd --prefix backend run build
if ($LASTEXITCODE -ne 0) { throw 'Fallo el build; no iniciar el backend.' }
npm.cmd --prefix backend start
```
El puerto 55434 es un ejemplo. Si está ocupado, seleccionar otro puerto libre y actualizar $env:DB_PORT antes de ejecutar Docker Compose.

Cada proyecto crea un contenedor independiente y el volumen
`${demoProject}_demo_pgdata`. Cada proyecto crea un volumen PostgreSQL independiente. Guardar el nombre de $demoProject para identificar los recursos de esa demostración..
El volumen vacío recibe automáticamente el esquema actual; no ejecutar migraciones
adicionales. `--wait` comprueba el healthcheck de PostgreSQL: `ps` debe indicar
`healthy`. Mantener el backend en **esa misma terminal**, para que use el nuevo
puerto y no la base anterior. Los recursos anteriores permanecen intactos.

En otras terminales, iniciar Angular con el comando de instalación anterior y
ejecutar `Invoke-RestMethod http://localhost:3000/api/health`: esperar `status: ok`
y `database: connected` antes de seguir con [Autorizar y demostrar el replay](#autorizar-y-demostrar-el-replay).
Para otra base limpia, repetir este único procedimiento con otro proyecto nuevo
y otro puerto libre. No se borran datos, contenedores ni volúmenes; no hay endpoint de borrado.

## Autorizar y demostrar el replay

1. Pulsar **Autorizar controles locales** en http://localhost:4200.
2. Usar usuario `replay` y REPLAY_PASSWORD del `.env` generado. Consultarla
   localmente en el editor, sin compartirla ni grabarla.
3. Dejar 750 ms y pulsar **Iniciar**. Pausar espera el evento en curso;
   Reanudar continúa desde ese índice. El dashboard recibe cambios por SSE.
4. Base nueva: **24 procesados, 20 aceptados, 2 duplicados, 2 rechazados**,
   8 vehículos y 4 alertas.
5. **Reiniciar**, luego **Iniciar**, sin limpiar: **0 aceptados, 22 duplicados,
   2 rechazados**. Persisten 20 eventos y 4 alertas; no se emiten SSE por duplicados.

Reiniciar restablece índice y contadores, nunca datos. Si la base ya contenía el
fixture completo, el primer recorrido observado tendrá los resultados del segundo.
El evento tardío alerta sin reemplazar estado reciente; 80 no alerta y 81 sí.
Dos pestañas comparten un motor. Se conserva el orden de las 24 líneas.

Cada control exige sesión aleatoria HttpOnly, SameSite=Strict, limitada a
`/api/replay`. Loopback y Origin permitido son defensas adicionales, no sustituyen
la autenticación. Otro sitio no recibe la cookie y otro Origin es rechazado incluso
con cookie válida. No introducir API_KEY en Angular ni publicar por túneles/proxies.
El replay envía un evento por paso mediante `POST /api/events/batch` en loopback,
con X-API-Key leída exclusivamente del entorno backend. Usa el mismo PORT del
servidor y un timeout de 10 segundos, sin redirecciones ni reintentos automáticos.
No se configura una URL externa. Ver [replay local](docs/replay-local.md).

## Verificaciones

```powershell
npm.cmd --prefix backend run typecheck
npm.cmd --prefix backend test
npm.cmd --prefix backend run build
npm.cmd --prefix frontend run build
```

Los tests normales usan dobles de PostgreSQL y reloj simulado, con HTTP/SSE reales
en loopback. Incluyen idempotencia, rollback, autorización, comandos simultáneos y
configuración segura. No leen el `.env` personal ni escriben en PostgreSQL.
Build Angular comprueba tipos y plantillas; no es E2E. Ver el resultado de la
[instalación aislada](docs/delivery-verification.md) para distinguir esas pruebas.

## Diagnóstico y límites

- EEXIST al generar entorno: se conservó `.env`. Revisarlo o usar otro clon.
- Puerto PostgreSQL ocupado: cambiar DB_PORT para el proyecto nuevo.
- Health 503: revisar Docker healthy y DB_* coincidentes. El volumen conserva
  usuarios y contraseña iniciales; no eliminarlo para arreglar una demo nueva.
- Replay 503: revisar REPLAY_ENABLED y REPLAY_PASSWORD; 401: volver a autorizar.
- Replay 403: usar `localhost:4200` y mantener `localhost` también para la API,
  sin mezclarlo con `127.0.0.1` en URLs del navegador.
- Angular 19 se conserva por alcance del reto; actualizar su soporte es tarea
  posterior. SSE/replay son de una instancia y no durables; faltan paginación,
  pruebas E2E y concurrencia real exhaustiva.

Requisitos originales: [contrato](docs/common-spec.md),
[criterios](docs/CRITERIOS-EVALUACION.md), [demo oficial](docs/DEMO-REPLAY.md).
