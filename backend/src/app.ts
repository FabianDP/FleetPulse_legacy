import express from "express";
import cors from "cors";
import { pool } from "./config/database";

export const app = express();

app.use(cors({
  origin: "http://localhost:4200"
}));

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "ok",
      database: "connected"
    });
  } catch {
    res.status(503).json({
      status: "error",
      database: "unavailable"
    });
  }
});