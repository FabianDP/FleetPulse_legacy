import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

export const requireApiKey: RequestHandler = (req, res, next) => {
  const expected = process.env.API_KEY;
  if (!expected) {
    res.status(503).json({ error: "AUTH_NOT_CONFIGURED" });
    return;
  }
  const supplied = req.get("X-API-Key");
  if (!supplied) {
    res.status(401).json({ error: "API_KEY_REQUIRED" });
    return;
  }
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (!timingSafeEqual(digest(supplied), digest(expected))) {
    res.status(403).json({ error: "INVALID_API_KEY" });
    return;
  }
  next();
};
