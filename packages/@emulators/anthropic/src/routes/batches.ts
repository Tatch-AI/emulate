import type { RouteContext } from "@emulators/core";
import { getAnthropicStore } from "../store.js";
import { createMessageFromBody } from "./messages.js";
import {
  anthropicError,
  generateBatchId,
  paginateById,
  parseJsonBody,
  withRequestId,
} from "../helpers.js";
import type { AnthropicBatch, BatchResultLine } from "../entities.js";

function formatBatch(batch: AnthropicBatch) {
  return {
    id: batch.batch_id,
    type: "message_batch" as const,
    processing_status: batch.processing_status,
    request_counts: { ...batch.request_counts },
    created_at: batch.created_at_iso,
    ended_at: batch.ended_at_iso,
    expires_at: batch.expires_at_iso,
    cancel_initiated_at: batch.cancel_initiated_at_iso,
    archived_at: batch.archived_at_iso,
    results_url: batch.results_url,
  };
}

export function batchRoutes(ctx: RouteContext): void {
  const { app, store, baseUrl } = ctx;

  app.post("/v1/messages/batches", async (c) => {
    const requestId = withRequestId(c);
    const bodyOrErr = await parseJsonBody(c);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const requests = body.requests;
    if (!Array.isArray(requests) || requests.length === 0) {
      return anthropicError(c, 400, "invalid_request_error", "requests: Field required", requestId);
    }

    const results: BatchResultLine[] = [];
    let succeeded = 0;
    let errored = 0;

    for (const req of requests) {
      if (!req || typeof req !== "object") {
        errored++;
        results.push({
          custom_id: "unknown",
          result: {
            type: "errored",
            error: { type: "invalid_request_error", message: "Invalid batch request entry" },
          },
        });
        continue;
      }
      const entry = req as Record<string, unknown>;
      const customId = String(entry.custom_id ?? "");
      const params = (entry.params ?? {}) as Record<string, unknown>;
      const created = createMessageFromBody(store, params);
      if ("error" in created) {
        errored++;
        results.push({
          custom_id: customId,
          result: {
            type: "errored",
            error: { type: created.error.type, message: created.error.message },
          },
        });
      } else {
        succeeded++;
        results.push({
          custom_id: customId,
          result: { type: "succeeded", message: created.message },
        });
      }
    }

    const now = new Date();
    const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const batchId = generateBatchId();
    const resultsUrl = `${baseUrl}/v1/messages/batches/${batchId}/results`;

    const batch = getAnthropicStore(store).batches.insert({
      batch_id: batchId,
      processing_status: "ended",
      request_counts: {
        processing: 0,
        succeeded,
        errored,
        canceled: 0,
        expired: 0,
      },
      created_at_iso: now.toISOString(),
      ended_at_iso: now.toISOString(),
      expires_at_iso: expires.toISOString(),
      cancel_initiated_at_iso: null,
      archived_at_iso: null,
      results_url: resultsUrl,
      results,
    });

    return c.json(formatBatch(batch));
  });

  app.get("/v1/messages/batches", (c) => {
    withRequestId(c);
    const items = getAnthropicStore(store)
      .batches.all()
      .sort((a, b) => (a.created_at_iso < b.created_at_iso ? 1 : -1))
      .map(formatBatch);
    const page = paginateById(items, {
      before_id: c.req.query("before_id"),
      after_id: c.req.query("after_id"),
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : 20,
    });
    return c.json(page);
  });

  app.get("/v1/messages/batches/:id", (c) => {
    withRequestId(c);
    const batch = getAnthropicStore(store).batches.findOneBy("batch_id", c.req.param("id"));
    if (!batch) return anthropicError(c, 404, "not_found_error", "Batch not found");
    return c.json(formatBatch(batch));
  });

  app.get("/v1/messages/batches/:id/results", (c) => {
    withRequestId(c);
    const batch = getAnthropicStore(store).batches.findOneBy("batch_id", c.req.param("id"));
    if (!batch) return anthropicError(c, 404, "not_found_error", "Batch not found");
    const lines = batch.results.map((line) => JSON.stringify(line)).join("\n") + (batch.results.length ? "\n" : "");
    return c.body(lines, 200, {
      "Content-Type": "application/x-jsonl; charset=utf-8",
    });
  });

  app.post("/v1/messages/batches/:id/cancel", (c) => {
    withRequestId(c);
    const as = getAnthropicStore(store);
    const batch = as.batches.findOneBy("batch_id", c.req.param("id"));
    if (!batch) return anthropicError(c, 404, "not_found_error", "Batch not found");

    const updated =
      as.batches.update(batch.id, {
        cancel_initiated_at_iso: batch.cancel_initiated_at_iso ?? new Date().toISOString(),
        processing_status: "ended",
      }) ?? batch;

    return c.json(formatBatch(updated));
  });

  app.delete("/v1/messages/batches/:id", (c) => {
    withRequestId(c);
    const as = getAnthropicStore(store);
    const batch = as.batches.findOneBy("batch_id", c.req.param("id"));
    if (!batch) return anthropicError(c, 404, "not_found_error", "Batch not found");
    as.batches.delete(batch.id);
    return c.json({ id: batch.batch_id, type: "message_batch_deleted" });
  });
}
