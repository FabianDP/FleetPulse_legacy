import { Pool } from "pg";

export const pool = new Pool({
  host: process.env.DB_HOST ?? "127.0.0.1",
  port: Number(process.env.DB_PORT ?? 5433),
  user: process.env.DB_USER ?? "fleetpulse",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? "fleetpulse",
  max: 10,
  connectionTimeoutMillis: 5000
});

pool.on("error", (error) => {
  console.error("PostgreSQL pool error:", error.message);
});