import type { ErrorRequestHandler } from "express";

export const httpErrorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  const type = typeof error === "object" && error !== null && "type" in error
    ? error.type : undefined;
  if (type === "entity.parse.failed") {
    res.status(400).json({ error: "INVALID_JSON" });
    return;
  }
  if (type === "entity.too.large") {
    res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
    return;
  }
  if (type === "request.aborted" || type === "request.size.invalid") {
    res.status(400).json({ error: "INVALID_REQUEST_BODY" });
    return;
  }
  if (type === "charset.unsupported" || type === "encoding.unsupported") {
    res.status(415).json({ error: "UNSUPPORTED_ENCODING" });
    return;
  }
  res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
};
