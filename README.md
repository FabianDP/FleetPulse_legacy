# FleetPulse

FleetPulse es un sistema de monitoreo GPS desarrollado para la prueba técnica de
Detektor. Moderniza una ingesta legacy con Node.js/TypeScript, PostgreSQL y Angular
19: valida eventos, evita duplicados, conserva el historial cronológico y genera
alertas por exceso de velocidad. El dashboard incluye búsqueda, historial del
vehículo seleccionado, actualizaciones SSE y recuperación tras reconexión.
Un replay HTTP permite demostrar el flujo con 24 eventos sintéticos.

## Instalación y arranque — Windows PowerShell

Ejecutar los comandos desde la raíz del repositorio, salvo el paso de clonación.
Se utilizan tres terminales:

| Terminal | Uso |
|---|---|
| PowerShell 1 | Preparación, PostgreSQL aislado y backend; mantenerla abierta. |
| PowerShell 2 | Servidor Angular; mantenerla abierta. |
| PowerShell 3 | Health, consultas y pruebas. |

### 1. Comprobar requisitos — terminal 1

Instalar Git, Docker Desktop con contenedores Linux, Docker Compose **v2.20+**,
Node.js **22.x** y npm **10+**. Iniciar Docker Desktop antes de continuar.
`.nvmrc` selecciona Node 22; con nvm compatible puede usarse `nvm use`.
No hace falta instalar Angular CLI globalmente.

```powershell
git --version
node --version
npm.cmd --version
docker compose version
```

**Resultado esperado:** comandos disponibles y versiones compatibles. Reservar
3000 para backend, 4200 para Angular y un puerto PostgreSQL libre; el ejemplo
utiliza 55434. No se necesitan variables personales exportadas en la terminal.

### 2. Clonar e instalar — terminal 1

```powershell
git clone https://github.com/FabianDP/FleetPulse_legacy.git
cd FleetPulse_legacy
node scripts/setup-env.cjs
npm.cmd --prefix backend ci
npm.cmd --prefix frontend ci
```

**Resultado esperado:** dependencias instaladas desde los lockfiles y un `.env`
raíz con tres credenciales locales independientes, sin imprimir sus valores.
Si `.env` ya existe, el generador falla sin leerlo ni sobrescribirlo: revisarlo
localmente o usar otro clon para la demostración. No continuar con credenciales
que correspondan a otra instancia PostgreSQL.

Alternativa manual: copiar `.env.example` solo si no existe `.env` y completar
DB_PASSWORD, API_KEY y REPLAY_PASSWORD con valores locales distintos y no vacíos.
No usar secretos de producción ni mostrar el archivo en capturas, logs o video.

### 3. Preparar una base limpia y arrancar backend — terminal 1

Este es el procedimiento único para crear una base de demostración **sin borrar
bases anteriores**. Usar una terminal sin DB_*, API_KEY, PORT o REPLAY_* heredadas;
si se abre otra terminal, volver a la raíz del clon. Conservar el `.env` preparado.
Si otro backend ocupa 3000, detenerlo normalmente con Ctrl+C sin tocar su base.

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

**Resultado esperado:** `ps` indica `healthy`, el build termina correctamente y el
backend queda escuchando en 3000. El healthcheck espera a PostgreSQL antes del arranque.
Si 55434 está ocupado, elegir otro puerto y actualizar `$env:DB_PORT` antes de Compose.

Mantener backend en **esta misma terminal**: DB_HOST/DB_PORT prevalecen sobre `.env`
tanto para Compose como para Node. Cada `$demoProject` crea su contenedor y volumen
`${demoProject}_demo_pgdata`; guardar ese nombre para identificar sus recursos.
No reutiliza `fleetpulse-postgres` ni su volumen. Utilizar siempre
`-f compose.yaml -p $demoProject`, sin combinar el histórico `docker-compose.yml`.

El volumen vacío inicializa únicamente `backend/database/schema.sql`: eventos,
estado, alertas e índices, con identificadores TEXT. No aplicar además la migración
`002-identifiers-text.sql`, destinada a bases antiguas VARCHAR(100). Para otra base
limpia, repetir el procedimiento con otro proyecto y puerto libre. No borrar datos,
contenedores o volúmenes; no hay endpoint de borrado.

Para desarrollo puede sustituirse el último comando por
`npm.cmd --prefix backend run dev`. No ejecutar start y dev simultáneamente.
Ambos cargan el mismo `.env` raíz, también si se ejecutan desde `backend`.

### 4. Verificar backend — terminal 3

Abrir PowerShell en la raíz del clon:

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

**Resultado esperado:** `status: ok` y `database: connected`. Si no se obtiene,
resolver el problema antes del replay; consultar los problemas frecuentes más abajo.

### 5. Iniciar Angular — terminal 2

Abrir otra PowerShell en la raíz del clon:

```powershell
npm.cmd --prefix frontend start -- --host localhost --port 4200
```

**Resultado esperado:** compilación de desarrollo satisfactoria y servidor disponible.
Abrir **http://localhost:4200**: aparecen dashboard, indicadores, tabla, alertas y
controles. Una base nueva todavía no contiene vehículos. Mantener terminales 1 y 2
abiertas mientras se prueba la aplicación.

En bash/zsh los comandos npm usan `npm` en lugar de `npm.cmd`; health puede
comprobarse con `curl --fail http://localhost:3000/api/health`. El bloque de
variables y comprobación de puertos anterior es específico de PowerShell.

## Demostración funcional

1. En Angular, pulsar **Autorizar controles locales**. En el diálogo del navegador,
   usar usuario `replay` y REPLAY_PASSWORD del `.env` generado, consultándola solo
   localmente en el editor. No grabar ni compartir la contraseña.
2. Mantener el intervalo de 750 ms y pulsar **Iniciar**. Debe avanzar progresivamente
   de 0 a 24 y actualizar el dashboard sin recargarlo.
3. Pulsar **Pausar** y esperar confirmación: no deben empezar nuevos eventos;
   el que estaba en curso termina. **Reanudar** continúa desde ese punto.
4. Al finalizar el primer recorrido, comprobar la tabla siguiente.
5. Pulsar **Reiniciar** y después **Iniciar**, conservando PostgreSQL. Comprobar
   los resultados del segundo recorrido.

| Resultado | Primer replay, base nueva | Segundo replay, sin limpiar |
|---|---:|---:|
| Procesados | 24 | 24 |
| Aceptados | 20 | 0 |
| Duplicados | 2 | 22 |
| Rechazados | 2 | 2 |
| Eventos persistidos | 20 | 20 |
| Vehículos | 8 | 8 |
| Alertas | 4 | 4 |

**Reiniciar restablece índice y contadores, nunca borra PostgreSQL.** Si la base
ya contenía el fixture completo, el primer recorrido observado dará los números
del segundo. Dos pestañas comparten un único motor. Se respeta el orden original
de las 24 líneas; los duplicados no generan notificaciones SSE nuevas.

Comprobar también:

- Buscar `VEH-001`: la tabla se filtra tras unos 300 ms y los indicadores conservan
  los totales globales. **Limpiar** vuelve a mostrar todos; una búsqueda sin
  coincidencias muestra **No se encontraron vehículos**.
- Seleccionar un identificador para consultar su historial GPS cronológico.
  El historial seleccionado y los vehículos se actualizan mediante SSE.
- El evento tardío `E-001-00` alerta sin sustituir el estado de `E-001-02`;
  `E-004-03` a 80 km/h no alerta y `E-005-03` a 81 sí.
- Tras una reconexión SSE se recuperan vehículos, alertas e historial seleccionado
  sin recarga manual. Reiniciar el proceso backend pierde sesión y progreso del
  replay: volver a autorizar los controles si es necesario.

Consultas adicionales, desde la terminal 3:

```powershell
Invoke-RestMethod 'http://localhost:3000/api/vehicles?search=VEH-001'
Invoke-RestMethod 'http://localhost:3000/api/vehicles/VEH-001/events'
Invoke-RestMethod 'http://localhost:3000/api/alerts'
```

Esperar el vehículo coincidente, su historial ordenado y las alertas históricas.
Más detalles: [guía del replay](docs/replay-local.md).

## Pruebas y compilación — terminal 3

Desde la raíz del clon:

```powershell
npm.cmd --prefix backend run typecheck
npm.cmd --prefix backend test
npm.cmd --prefix backend run build
npm.cmd --prefix frontend test -- --watch=false --browsers=ChromeHeadless
npm.cmd --prefix frontend run build -- --configuration production
```

**Resultados recientes reportados:** 35 pruebas backend y 6 Angular aprobadas,
0 fallidas; compilación de producción Angular satisfactoria. Los comandos
permiten repetir la validación, sin atribuir una nueva ejecución a este README.
El script backend test compila antes de ejecutar `node:test`.

### Usar Microsoft Edge cuando Chrome no está disponible

Las pruebas Angular usan Karma y el launcher ChromeHeadless. En Windows puede
indicarse el ejecutable Chromium de Edge mediante CHROME_BIN, sin instalar otro
launcher ni modificar configuración:

```powershell
$edgePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'
if (-not (Test-Path -LiteralPath $edgePath)) {
    $edgePath = Join-Path $env:ProgramFiles 'Microsoft/Edge/Application/msedge.exe'
}
if (-not (Test-Path -LiteralPath $edgePath)) {
    throw 'Edge no encontrado: indique su ruta instalada en CHROME_BIN antes de ejecutar las pruebas.'
}
$env:CHROME_BIN = $edgePath
npm.cmd --prefix frontend test -- --watch=false --browsers=ChromeHeadless
```

**Resultado esperado:** Karma inicia el navegador en modo headless y termina con
6 pruebas correctas. CHROME_BIN solo afecta esta terminal y sus procesos hijos.
Si Edge está instalado en otra ruta, asignar esa ruta real a CHROME_BIN.

Las pruebas backend usan persistencia simulada y, según el caso, reloj simulado,
con conexiones HTTP/SSE reales en loopback. Cubren validación, idempotencia,
conflictos, rollback simulado, autenticación, replay y configuración; no escriben
en PostgreSQL ni requieren el `.env` personal. Las seis Angular usan servicios
simulados: creación, contadores, búsqueda con debounce, historial,
`vehicle.updated` y `stream.reconnected`. No equivalen a E2E de navegador con
backend y PostgreSQL reales. Un build comprueba compilación, tipos y plantillas.

El [registro de instalación aislada](docs/delivery-verification.md) distingue el
ensayo histórico con PostgreSQL real, anterior al adaptador HTTP, de estas suites.
Las validaciones manuales posteriores se documentan con su fuente en las evidencias.

## Variables de entorno y seguridad

El backend carga `.env` **de la raíz**, antes del pool, desde `src` o `dist`, sin
depender del directorio de ejecución. No carga un `.env` dentro de backend.
Las variables exportadas explícitamente tienen precedencia.

| Variable | Uso |
|---|---|
| DB_HOST | `127.0.0.1`; Node corre fuera de Docker. |
| DB_PORT | `5434` en la configuración de ejemplo; el procedimiento aislado usa `55434` mediante la terminal. |
| DB_USER / DB_NAME | `fleetpulse_demo`, iguales en Compose y backend. |
| DB_PASSWORD | Contraseña local generada; obligatoria para Compose. |
| PORT | `3000`; Angular y el login utilizan este puerto. |
| API_KEY | Protege POST /api/events/batch; exclusiva del backend/reproductor. |
| REPLAY_ENABLED | `true` habilita controles; `false` los bloquea. |
| REPLAY_PASSWORD | Contraseña independiente para autorizar el replay. |

`DATABASE_URL` no se consume. `.env` permanece excluido de Git. Cambiarlo no cambia
usuarios o contraseñas de un volumen ya inicializado ni vuelve a ejecutar SQL.
PostgreSQL solo se publica en localhost; no exponer panel, API o SSE por Internet,
túneles o proxies con esta configuración de demostración.

La ingesta requiere X-API-Key: cabecera ausente devuelve 401 e incorrecta 403.
El replay la lee del entorno backend y envía cada evento por HTTP al mismo servidor
en loopback, con timeout de 10 segundos, sin URL externa, redirecciones ni reintentos
automáticos. Nunca introducir esa clave en Angular, URLs, logs o video.

Los controles usan sesión aleatoria HttpOnly, SameSite=Strict, restringida a
`/api/replay`. Loopback y Origin permitido complementan la autenticación; CORS
por sí solo no autoriza. Usar `localhost` en las URLs del navegador para mantener
coherencia de cookies y orígenes.

## Problemas frecuentes y límites

| Síntoma | Qué revisar |
|---|---|
| EEXIST al generar entorno | `.env` se conservó. Revisarlo localmente o usar otro clon; no sobrescribirlo automáticamente. |
| Puerto PostgreSQL ocupado | Elegir otro DB_PORT libre para el proyecto nuevo antes de Compose. |
| Health 503 o error de autenticación PostgreSQL | Estado healthy, destino y DB_* coincidentes. El volumen conserva sus credenciales iniciales; no borrarlo para corregir una conexión. |
| Replay 503 | REPLAY_ENABLED, REPLAY_PASSWORD y disponibilidad del fixture; consultar errores seguros del replay. |
| Replay 401 | Volver a autorizar el navegador, especialmente tras reiniciar backend. |
| Replay 403 | Usar localhost:4200 y localhost para la API; no mezclar 127.0.0.1 en el navegador. |
| Karma no encuentra Chrome | Configurar CHROME_BIN hacia Edge según el procedimiento anterior. |

SSE, sesiones y progreso del replay residen en un proceso y no son durables.
La recuperación por GET restaura el dashboard, pero no reproduce todos los avisos
perdidos. Siguen pendientes concurrencia real exhaustiva, paginación, E2E
automatizado completo y ensayo de rollback. Angular 19 se conserva por el alcance
del reto; revisar toolchain y dependencias antes de ampliar el despliegue.

## Documentación y evidencias

- [Contrato común](docs/common-spec.md), [criterios](docs/CRITERIOS-EVALUACION.md)
  y [demo oficial](docs/DEMO-REPLAY.md).
- [Modernización del legacy](docs/LEGACY-MODERNIZATION.md): defectos, correcciones,
  integridad, transición y rollback propuesto.
- [Flujo de trabajo con IA](docs/AI-WORKFLOW.md): iteraciones, revisión humana y CI.
- [Retrospectiva](docs/RETROSPECTIVA.md): decisiones, resultados y próximos pasos.
- [Evidencias ampliadas](docs/ai-development-evidence.md) y
  [verificación de instalación](docs/delivery-verification.md).

**Video de demostración pendiente:** todavía no se presenta como entregado.
