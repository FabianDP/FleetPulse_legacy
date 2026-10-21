import "dotenv/config";
import { app } from "./app";
import { pool } from "./config/database";
import { streamService } from "./services/stream.service";
import { replayService } from "./services/replay.service";

const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, "127.0.0.1", () => {
  console.log(`FleetPulse API running on http://localhost:${port}`);
});

async function shutdown() {
  await replayService.stop();
  streamService.closeAll();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
