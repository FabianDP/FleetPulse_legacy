import { Router } from "express";
import { localDashboardOnly } from "../middlewares/local-dashboard.middleware";
import { listAlerts, listVehicles, vehicleHistory } from "../services/dashboard.service";
import { streamService } from "../services/stream.service";
import { alertQuerySchema, vehicleParamsSchema, vehicleQuerySchema } from "../validators/query.validator";

export const dashboardRouter = Router();
dashboardRouter.use(localDashboardOnly);

dashboardRouter.get("/vehicles", async (req, res) => {
  const parsed = vehicleQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  res.json(await listVehicles(parsed.data));
});

dashboardRouter.get("/vehicles/:vehicleId/events", async (req, res) => {
  const parsed = vehicleParamsSchema.safeParse(req.params);
  if (!parsed.success || Object.keys(req.query).length !== 0) {
    res.status(400).json({ error: "INVALID_QUERY" }); return;
  }
  // Unknown vehicles return [], as permitted by the common contract.
  res.json(await vehicleHistory(parsed.data.vehicleId));
});

dashboardRouter.get("/alerts", async (req, res) => {
  const parsed = alertQuerySchema.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  res.json(await listAlerts(parsed.data));
});

dashboardRouter.get("/stream", (req, res) => {
  if (Object.keys(req.query).length !== 0) {
    res.status(400).json({ error: "INVALID_QUERY" }); return;
  }
  streamService.connect(req, res);
});
