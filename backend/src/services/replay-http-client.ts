import { z } from "zod";
import type { ingestBatch } from "./event.service";

type BatchResult = Awaited<ReturnType<typeof ingestBatch>>;
type TransportCode = "REPLAY_HTTP_CONFIG_ERROR" | "REPLAY_HTTP_AUTH_ERROR"
  | "REPLAY_HTTP_ERROR" | "REPLAY_HTTP_TIMEOUT" | "REPLAY_HTTP_UNAVAILABLE"
  | "REPLAY_HTTP_INVALID_RESPONSE";

export class ReplayTransportError extends Error {
  constructor(public readonly code: TransportCode) { super(code); }
}

// Wire-response validation only; telemetry rules remain in the ingestion endpoint.
const responseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  errors: z.array(z.object({
    index: z.number().int().nonnegative(),
    reason: z.enum(["INVALID_EVENT", "INVALID_EVENT_ID", "INVALID_VEHICLE_ID",
      "INVALID_OBSERVED_AT", "INVALID_LATITUDE", "INVALID_LONGITUDE", "INVALID_SPEED",
      "INVALID_IGNITION", "EVENT_ID_CONFLICT"])
  }))
});

export function createReplayHttpClient(options: { port?: number; timeoutMs?: number } = {}) {
  return async (events: unknown[]): Promise<BatchResult> => {
    const key = process.env.API_KEY;
    const port = options.port ?? Number(process.env.PORT ?? 3000);
    const timeoutMs = options.timeoutMs ?? 10000;
    if (!key || !Number.isInteger(port) || port < 1 || port > 65535
      || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) {
      throw new ReplayTransportError("REPLAY_HTTP_CONFIG_ERROR");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref();
    try {
      // Literal loopback, fixed path, no redirects or destination supplied by a browser.
      const response = await fetch(`http://127.0.0.1:${port}/api/events/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": key },
        body: JSON.stringify({ events }),
        redirect: "manual",
        signal: controller.signal
      });
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new ReplayTransportError(response.status === 401 || response.status === 403
          ? "REPLAY_HTTP_AUTH_ERROR" : "REPLAY_HTTP_ERROR");
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        await response.body?.cancel();
        throw new ReplayTransportError("REPLAY_HTTP_INVALID_RESPONSE");
      }
      let body: unknown;
      try { body = await response.json(); }
      catch {
        if (controller.signal.aborted) throw new ReplayTransportError("REPLAY_HTTP_TIMEOUT");
        throw new ReplayTransportError("REPLAY_HTTP_INVALID_RESPONSE");
      }
      const parsed = responseSchema.safeParse(body);
      if (!parsed.success) throw new ReplayTransportError("REPLAY_HTTP_INVALID_RESPONSE");
      const result = parsed.data;
      if (result.accepted + result.duplicates + result.rejected !== events.length
        || result.errors.length !== result.rejected
        || result.errors.some(error => error.index >= events.length)
        || new Set(result.errors.map(error => error.index)).size !== result.errors.length) {
        throw new ReplayTransportError("REPLAY_HTTP_INVALID_RESPONSE");
      }
      return {
        ...result,
        errors: result.errors.map(error => {
          const raw = events[error.index];
          // Do not propagate arbitrary server fields or error text to replay status.
          const eventId = typeof raw === "object" && raw !== null && "eventId" in raw
            && typeof raw.eventId === "string" ? raw.eventId : undefined;
          return { ...error, ...(eventId === undefined ? {} : { eventId }) };
        })
      };
    } catch (error) {
      if (error instanceof ReplayTransportError) throw error;
      throw new ReplayTransportError(controller.signal.aborted
        ? "REPLAY_HTTP_TIMEOUT" : "REPLAY_HTTP_UNAVAILABLE");
    } finally { clearTimeout(timer); }
  };
}

export const postReplayBatch = createReplayHttpClient();
