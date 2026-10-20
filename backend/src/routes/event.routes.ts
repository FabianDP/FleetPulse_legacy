import { Router } from "express";
import { batchSchema } from "../validators/event.validator";
import { ingestBatch } from "../services/event.service";

export const eventRouter = Router();

eventRouter.post("/batch", async (req, res) => {
  const parsed = batchSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({
      error: "INVALID_BATCH"
    });
    return;
  }

  try {
    const result = await ingestBatch(parsed.data.events);
    res.status(200).json(result);
  } catch {
    res.status(500).json({
      error: "INTERNAL_SERVER_ERROR"
    });
  }
});