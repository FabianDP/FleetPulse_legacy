import type { Request, Response } from "express";
import type { TelemetryEvent } from "../validators/event.validator";

export type StreamMessage = {
  type: "vehicle.updated" | "alert.created";
  eventId: string;
  vehicleId: string;
  observedAt: string;
  data: TelemetryEvent & { status?: "OFF" | "MOVING" | "STOPPED"; type?: "OVERSPEED" };
};

type Subscriber = { send: (frame: string) => void; close: () => void };

export class StreamService {
  private readonly subscribers = new Set<Subscriber>();

  constructor(private readonly heartbeatMs = 15000) {}

  get clientCount(): number { return this.subscribers.size; }

  connect(req: Request, res: Response): void {
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.flushHeaders();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      this.subscribers.delete(subscriber);
      res.off("close", close);
      res.off("error", close);
      req.off("aborted", close);
      res.destroy();
    };
    const subscriber: Subscriber = {
      close,
      send: frame => {
        if (closed) return;
        try {
          // Disconnect slow clients rather than growing an unbounded buffer.
          if (!res.write(frame)) close();
        } catch { close(); }
      }
    };
    const timer = setInterval(() => subscriber.send(": heartbeat\n\n"), this.heartbeatMs);
    timer.unref();
    this.subscribers.add(subscriber);
    res.on("close", close);
    res.on("error", close);
    req.on("aborted", close);
    subscriber.send("retry: 3000\n: connected\n\n");
  }

  publish(message: StreamMessage): void {
    const frame = `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`;
    for (const subscriber of this.subscribers) subscriber.send(frame);
  }

  closeAll(): void {
    for (const subscriber of this.subscribers) subscriber.close();
  }
}

export const streamService = new StreamService();
