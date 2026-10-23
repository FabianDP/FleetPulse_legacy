import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

const cookieName = "fleetpulse_replay";
const lifetimeMs = 4 * 60 * 60 * 1000;
const digest = (value: string) => createHash("sha256").update(value).digest();
let session: { hash: Buffer; expiresAt: number } | undefined;

export const replayEnabled: RequestHandler = (_req, res, next) => {
  if (process.env.REPLAY_ENABLED !== "true" || !process.env.REPLAY_PASSWORD) {
    res.status(503).json({ error: "REPLAY_DISABLED" });
    return;
  }
  next();
};

// Direct browser navigation authenticates outside Angular and issues an HttpOnly cookie.
export const replayLogin: RequestHandler = (req, res) => {
  res.set("Cache-Control", "no-store");
  const authorization = req.get("Authorization");
  if (!authorization?.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="FleetPulse local replay", charset="UTF-8"');
    res.status(401).json({ error: "REPLAY_LOGIN_REQUIRED" });
    return;
  }
  const credentials = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  if (!timingSafeEqual(digest(credentials), digest(`replay:${process.env.REPLAY_PASSWORD}`))) {
    res.status(403).json({ error: "INVALID_REPLAY_CREDENTIALS" });
    return;
  }
  const token = randomBytes(32).toString("hex");
  session = { hash: digest(token), expiresAt: Date.now() + lifetimeMs };
  res.cookie(cookieName, token, { httpOnly: true, sameSite: "strict", path: "/api/replay", maxAge: lifetimeMs });
  res.redirect(303, "http://localhost:4200");
};

export const requireReplaySession: RequestHandler = (req, res, next) => {
  res.set("Cache-Control", "no-store");
  const token = req.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token || !session || session.expiresAt <= Date.now() || !timingSafeEqual(digest(token), session.hash)) {
    res.status(401).json({ error: "REPLAY_SESSION_REQUIRED" });
    return;
  }
  next();
};
