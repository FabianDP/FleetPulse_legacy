import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ingestBatch } from "./event.service";

type BatchResult = Awaited<ReturnType<typeof ingestBatch>>;
export type ReplayState = "idle" | "running" | "paused" | "completed" | "error";
export type ReplayProgress = {
  state: ReplayState;
  processed: number;
  total: number;
  accepted: number;
  duplicates: number;
  rejected: number;
  intervalMs: number;
  errors: BatchResult["errors"];
};

export class ReplayControlError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function loadReplayFixture(): Promise<unknown[]> {
  const contents = await readFile(resolve(__dirname, "../../../fixtures/events.jsonl"), "utf8");
  return contents.trimEnd().split(/\r?\n/).map((line: string) => JSON.parse(line) as unknown);
}

export class ReplayService {
  private events?: unknown[];
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private progress: ReplayProgress = this.emptyProgress();

  constructor(
    private readonly load: () => Promise<unknown[]> = loadReplayFixture,
    private readonly ingest: (events: unknown[]) => Promise<BatchResult> = ingestBatch
  ) {}

  private emptyProgress(): ReplayProgress {
    return { state: "idle", processed: 0, total: 0, accepted: 0, duplicates: 0,
      rejected: 0, intervalMs: 750, errors: [] };
  }

  private snapshot(): ReplayProgress {
    return { ...this.progress, errors: this.progress.errors.map(error => ({ ...error })) };
  }

  private serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async initialize(): Promise<void> {
    if (this.events) return;
    try {
      const events = await this.load();
      if (events.length === 0) throw new Error("Empty fixture");
      this.events = events;
      this.progress.total = events.length;
    } catch {
      throw new ReplayControlError(503, "REPLAY_FIXTURE_UNAVAILABLE");
    }
  }

  private cancelTimer(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.generation++;
  }

  private setIntervalMs(intervalMs?: number): void {
    if (intervalMs === undefined) return;
    if (!Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 60000) {
      throw new ReplayControlError(400, "INVALID_REPLAY_INTERVAL");
    }
    this.progress.intervalMs = intervalMs;
  }

  private schedule(): void {
    const generation = this.generation;
    this.timer = setTimeout(() => {
      void this.serialize(async () => {
        if (generation !== this.generation || this.progress.state !== "running") return;
        this.timer = undefined;
        const index = this.progress.processed;
        try {
          const result = await this.ingest([this.events![index]]);
          this.progress.accepted += result.accepted;
          this.progress.duplicates += result.duplicates;
          this.progress.rejected += result.rejected;
          this.progress.errors.push(...result.errors.map(error => ({ ...error, index: index + error.index })));
          this.progress.processed++;
          if (this.progress.processed === this.progress.total) this.progress.state = "completed";
          else this.schedule();
        } catch {
          this.progress.state = "error";
          this.progress.errors.push({ index, reason: "INGESTION_FAILED" });
        }
      });
    }, this.progress.intervalMs);
    this.timer.unref();
  }

  status(): Promise<ReplayProgress> {
    return this.serialize(async () => { await this.initialize(); return this.snapshot(); });
  }

  start(intervalMs?: number): Promise<ReplayProgress> {
    return this.serialize(async () => {
      await this.initialize();
      if (this.progress.state !== "idle") throw new ReplayControlError(409, "REPLAY_NOT_IDLE");
      this.setIntervalMs(intervalMs);
      this.cancelTimer();
      this.progress.state = "running";
      this.schedule();
      return this.snapshot();
    });
  }

  pause(): Promise<ReplayProgress> {
    return this.serialize(() => {
      if (this.progress.state !== "running") throw new ReplayControlError(409, "REPLAY_NOT_RUNNING");
      this.cancelTimer();
      this.progress.state = "paused";
      return this.snapshot();
    });
  }

  resume(intervalMs?: number): Promise<ReplayProgress> {
    return this.serialize(() => {
      if (this.progress.state !== "paused" && this.progress.state !== "error") {
        throw new ReplayControlError(409, "REPLAY_NOT_PAUSED");
      }
      this.setIntervalMs(intervalMs);
      this.cancelTimer();
      this.progress.state = "running";
      this.schedule();
      return this.snapshot();
    });
  }

  restart(intervalMs?: number): Promise<ReplayProgress> {
    return this.serialize(async () => {
      await this.initialize();
      this.setIntervalMs(intervalMs);
      const interval = this.progress.intervalMs;
      this.cancelTimer();
      this.progress = { ...this.emptyProgress(), total: this.events!.length, intervalMs: interval };
      return this.snapshot();
    });
  }

  stop(): Promise<void> {
    return this.serialize(() => {
      this.cancelTimer();
      if (this.progress.state === "running") this.progress.state = "paused";
    });
  }
}

export const replayService = new ReplayService();
