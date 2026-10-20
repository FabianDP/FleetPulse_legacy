import "dotenv/config";
import { app } from "./app";
import { pool } from "./config/database";

const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, () => {
  console.log(`FleetPulse API running on http://localhost:${port}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);