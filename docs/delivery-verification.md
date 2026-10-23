# Verificación de instalación — 21 de octubre de 2026

Este registro corresponde al replay original con llamada directa al servicio de
ingesta. La corrección HTTP posterior se documenta en
[evidencias de desarrollo](ai-development-evidence.md#corrección-posterior-a-la-revisión-humana-transporte-http-del-replay).
Sus pruebas nuevas usan HTTP real y persistencia simulada: los resultados reales
de PostgreSQL que siguen no se atribuyen al adaptador HTTP nuevo.

## Entornos utilizados

- Windows: Node 24.21.0, npm 11.19.0, Docker Engine 29.9.1, Compose 5.6.0.
- Linux en un contenedor nuevo `node:22`: Node 22.23.4 y npm 10.9.9.
- PostgreSQL real 18.6, inicializado desde `schema.sql` en un volumen nuevo.

La copia de prueba `.verification/install-20261021` excluyó `.env`, node_modules,
dist y configuración personal. Se generó allí otro `.env` con credenciales nuevas,
sin mostrarlas. `.verification/` está ignorado por Git.

## Resultados ejecutados

| Comprobación | Resultado y alcance |
|---|---|
| `npm ci` en Windows, ambos proyectos | Correcto, instalaciones vacías usando caché npm offline |
| `npm ci` con Node 22, ambos proyectos | Correcto, contenedor y caché vacíos; descargas desde el registro npm |
| Backend typecheck y build | Correctos en Windows y Node 22/Linux |
| Backend tests | 26 aprobados en ambos entornos; persistencia simulada en la suite normal |
| Angular production build | Correcto en ambos entornos, incluidos los paquetes instalados desde cero |
| Compose config | Validación correcta sin imprimir la configuración interpolada |
| Compose up con volumen nuevo | Healthy; esquema inicializado sin ejecutar migraciones |
| Health con arranque compilado | 200, status ok, database connected |
| Primera reproducción, PostgreSQL real | 20 aceptados, 2 duplicados, 2 rechazados; 20 eventos, 8 vehículos, 4 alertas |
| Estados e historiales reales | Coinciden con latest_by_vehicle y history_by_vehicle_ascending del oráculo |
| Segunda reproducción, misma base | 0 aceptados, 22 duplicados, 2 rechazados, sin nuevas emisiones SSE |
| Pausa/reanudación reales | Progreso estable después de confirmar pausa; reanudación completa |
| Protección HTTP real | Sin sesión: 401; comando con sesión pero Origin externo: 403 |
| Arranque fuente con tsx | Health correcto fuera del sandbox; lectura del `.env` raíz confirmada |
| `git diff --check` | Sin errores de whitespace |

La prueba HTTP real usó el puerto 31431 para no interferir con un backend personal;
solo PORT se sustituyó explícitamente. DB_* y credenciales procedían del `.env`
nuevo. El proceso compilado se ejecutó con `node dist/server.js`, exactamente el
comando del script npm start. La comprobación fuente utilizó
`node --import tsx src/server.ts`; no se verificó el ciclo de recarga de `tsx watch`.
La prueba real de PostgreSQL se ejecutó en Windows/Node 24; Node 22 cubrió instalación,
tipos, tests con mocks y builds. No se ejecutó una segunda base real bajo Node 22.

`tsx` falló inicialmente dentro del sandbox con `uv_os_get_passwd`; la misma
comprobación fuera del sandbox pasó. Se trata de una limitación observada del
entorno de ejecución, no de un fallo reproducido en la instalación normal.

## Recursos conservados

Proyecto de base de prueba: `fleetpulse-check-20261021-7b2c`. Se comprobó previamente
que no existían sus recursos. Contenedor `fleetpulse-check-20261021-7b2c-db-1`
detenido al finalizar; volumen `fleetpulse-check-20261021-7b2c_demo_pgdata` conservado
con 20 eventos, 8 estados y 4 alertas. El contenedor de herramientas Node 22 terminó
su ejecución; se conservan también sus volúmenes de dependencias de verificación.
No se eliminaron contenedores, imágenes ni volúmenes y no se modificó el proyecto
PostgreSQL preexistente.

## Pendiente y riesgos

- Verificación visual/E2E de la autorización nativa y controles en navegador.
  El usuario ya informó pruebas manuales previas; esta iteración no las repitió.
- Prueba del watcher de desarrollo, concurrencia real exhaustiva y despliegues
  con varias instancias. SSE y replay siguen siendo de una sola instancia.
- npm emitió avisos de paquetes transitivos obsoletos del toolchain Angular.
  No se ejecutó una auditoría de vulnerabilidades ni se cambiaron versiones;
  revisar por separado sin confundir el build correcto con una auditoría.
- Los tags Docker `postgres:18` y `node:22` reciben actualizaciones de parche;
  los lockfiles fijan npm, pero no las imágenes. Los números anteriores describen
  las versiones efectivamente probadas, no garantizan imágenes futuras idénticas.
- No se detectó un bloqueo de instalación limpia en los entornos probados.
  Un `.env` personal, puerto ocupado o volumen ya inicializado necesita la revisión
  descrita en el README; no se sobrescribe ni borra para resolverlo.
