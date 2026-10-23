import { Router } from "express";
import { z } from "zod";
import { localDashboardOnly } from "../middlewares/local-dashboard.middleware";
import { replayEnabled, replayLogin, requireReplaySession } from "../middlewares/replay-session.middleware";
import { replayService, ReplayControlError } from "../services/replay.service";

const intervalSchema = z.object({ intervalMs: z.number().int().min(100).max(60000).optional() }).strict();
export const replayRouter = Router();
replayRouter.use(localDashboardOnly, replayEnabled);
replayRouter.get("/login", replayLogin);
replayRouter.use(requireReplaySession);

replayRouter.get("/", async (_req, res) => {
  try { res.json(await replayService.status()); }
  catch (error) {
    if (!(error instanceof ReplayControlError)) throw error;
    res.status(error.status).json({ error: error.message });
  }
});

for (const action of ["start", "pause", "resume", "restart"] as const) {
  replayRouter.post(`/${action}`, async (req, res) => {
    const parsed = intervalSchema.safeParse(req.body ?? {});
    if (!parsed.success || Object.keys(req.query).length !== 0 || (action === "pause" && parsed.data.intervalMs !== undefined)) {
      res.status(400).json({ error: "INVALID_REPLAY_REQUEST" });
      return;
    }
    try {
      res.json(await replayService[action](parsed.data.intervalMs));
    } catch (error) {
      if (!(error instanceof ReplayControlError)) throw error;
      res.status(error.status).json({ error: error.message });
    }
  });
}
