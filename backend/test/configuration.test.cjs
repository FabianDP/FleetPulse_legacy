const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { setupEnvironment } = require("../../scripts/setup-env.cjs");
const { rootEnvironmentPath } = require("../dist/config/environment");
const root = path.resolve(__dirname, "../..");

test("configuración: secretos independientes y creación exclusiva de .env", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fleetpulse-config-"),
  );
  fs.copyFileSync(
    path.join(root, ".env.example"),
    path.join(directory, ".env.example"),
  );
  setupEnvironment(directory);
  const original = fs.readFileSync(path.join(directory, ".env"), "utf8");
  const values = require("dotenv").parse(original);
  for (const key of ["DB_PASSWORD", "API_KEY", "REPLAY_PASSWORD"])
    assert.match(values[key], /^[a-f0-9]{48}$/);
  assert.equal(
    new Set([values.DB_PASSWORD, values.API_KEY, values.REPLAY_PASSWORD]).size,
    3,
  );
  assert.throws(() => setupEnvironment(directory), { code: "EEXIST" });
  assert.ok(fs.readFileSync(path.join(directory, ".env"), "utf8") === original);
});

test("configuración: ruta raíz estable y carga independiente del cwd", () => {
  assert.equal(rootEnvironmentPath, path.join(root, ".env"));
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "fleetpulse-loader-"),
  );
  const file = path.join(directory, ".env");
  fs.writeFileSync(file, "FLEETPULSE_CONFIG_TEST=loaded\n");
  const modulePath = path.join(root, "backend/dist/config/environment.js");
  const script =
    "require(process.argv[1]).loadEnvironment(process.argv[2]); process.stdout.write(process.env.FLEETPULSE_CONFIG_TEST)";
  const environment = { ...process.env };
  delete environment.FLEETPULSE_CONFIG_TEST;
  const child = spawnSync(process.execPath, ["-e", script, modulePath, file], {
    cwd: directory,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, "loaded");
  const explicit = spawnSync(
    process.execPath,
    ["-e", script, modulePath, file],
    {
      cwd: directory,
      env: { ...environment, FLEETPULSE_CONFIG_TEST: "explicit" },
      encoding: "utf8",
    },
  );
  assert.equal(explicit.stdout, "explicit");
});

test("entrega: compose aislado, esquema actual y documentación enlazada", () => {
  const compose = fs.readFileSync(path.join(root, "compose.yaml"), "utf8");
  assert.match(compose, /name: fleetpulse-demo/);
  assert.match(compose, /127\.0\.0\.1:\$\{DB_PORT:-5434\}:5432/);
  assert.match(compose, /DB_PASSWORD:\?/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /demo_pgdata:\/var\/lib\/postgresql/);
  assert.match(compose, /001-schema\.sql/);
  assert.doesNotMatch(compose, /container_name|fleetpulse-postgres|migrations/);
  const schema = fs.readFileSync(
    path.join(root, "backend/database/schema.sql"),
    "utf8",
  );
  assert.match(schema, /event_id TEXT PRIMARY KEY/);
  assert.ok(
    schema.indexOf("CREATE TABLE IF NOT EXISTS telemetry_events") <
      schema.indexOf("CREATE TABLE IF NOT EXISTS alerts"),
  );
  const example = require("dotenv").parse(
    fs.readFileSync(path.join(root, ".env.example")),
  );
  for (const key of ["DB_PASSWORD", "API_KEY", "REPLAY_PASSWORD"])
    assert.equal(example[key], "");
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  for (const match of readme.matchAll(/\]\(([^)]+)\)/g)) {
    const link = match[1];

    // Ignorar enlaces externos y enlaces a secciones del README
    if (link.startsWith("http") || link.startsWith("#")) {
      continue;
    }
    // Validar que los archivos enlazados existan
    assert.ok(
      fs.existsSync(path.resolve(root, link)),
      `Archivo enlazado no encontrado: ${link}`,
    );
  }
  assert.match(readme, /22 duplicados/);
  assert.match(
    fs.readFileSync(path.join(root, ".gitignore"), "utf8"),
    /^\.env$/m,
  );
  for (const project of ["backend", "frontend"]) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, project, "package.json")),
    );
    const lock = JSON.parse(
      fs.readFileSync(path.join(root, project, "package-lock.json")),
    );
    assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
    assert.deepEqual(
      lock.packages[""].devDependencies,
      manifest.devDependencies,
    );
  }
});
