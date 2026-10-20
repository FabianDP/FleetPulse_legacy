import type { RequestHandler } from "express";

// The local dashboard never receives the producer's API key.
export const localDashboardOnly: RequestHandler = (req, res, next) => {
  const address = req.socket.remoteAddress;
  const origin = req.get("Origin");
  const local = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  if (!local || (origin !== undefined && origin !== "http://localhost:4200")) {
    res.status(403).json({ error: "LOCAL_DASHBOARD_ONLY" });
    return;
  }
  next();
};
