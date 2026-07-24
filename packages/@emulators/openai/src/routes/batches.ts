import type { RouteContext } from "@emulators/core";
import { getOpenAIStore } from "../store.js";
import type { OpenAIStore } from "../store.js";
import {
  applyOpenAIHeaders,
  batchId,
  defaultEmbeddingDims,
  deterministicEmbedding,
  estimateTokens,
  fileId,
  generateReply,
  lastUserMessageText,
  logRequest,
  modelExists,
  openaiError,
  parseJsonBody,
  requireOpenAIAuth,
  unixNow,
  usageDetails,
} from "../helpers.js";

export function batchRoutes({ app, store }: RouteContext): void {
  const os = () => getOpenAIStore(store);

  app.post("/v1/batches", async (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    const rid = applyOpenAIHeaders(c);

    const bodyOrErr = await parseJsonBody(c);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const inputFileId = body.input_file_id as string | undefined;
    const endpoint = body.endpoint as string | undefined;
    const completionWindow = (body.completion_window as string | undefined) ?? "24h";

    if (!inputFileId) {
      return openaiError(
        c,
        400,
        "Missing required parameter: 'input_file_id'",
        "invalid_request_error",
        null,
        "input_file_id",
      );
    }
    if (!endpoint) {
      return openaiError(c, 400, "Missing required parameter: 'endpoint'", "invalid_request_error", null, "endpoint");
    }
    if (completionWindow !== "24h") {
      return openaiError(
        c,
        400,
        "Invalid 'completion_window': currently only '24h' is supported",
        "invalid_request_error",
        null,
        "completion_window",
      );
    }

    const inputFile = os().files.findOneBy("file_id", inputFileId);
    if (!inputFile || inputFile.status === "deleted") {
      return openaiError(c, 400, `No such File object: '${inputFileId}'`, "invalid_request_error", null, "input_file_id");
    }
    if (inputFile.purpose !== "batch") {
      return openaiError(
        c,
        400,
        "Input file must have purpose 'batch'",
        "invalid_request_error",
        null,
        "input_file_id",
      );
    }

    const lines = inputFile.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    let completed = 0;
    let failed = 0;
    const outputLines: string[] = [];

    for (const line of lines) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        failed++;
        outputLines.push(
          JSON.stringify({
            id: `batch_req_${failed}`,
            custom_id: null,
            response: null,
            error: { code: "invalid_json", message: "Could not parse JSONL line" },
          }),
        );
        continue;
      }

      const customId = (parsed.custom_id as string | undefined) ?? null;
      const url = (parsed.url as string | undefined) ?? endpoint;
      const reqBody = (parsed.body as Record<string, unknown>) ?? {};

      try {
        const result = processBatchRequest(os(), url, reqBody);
        completed++;
        outputLines.push(
          JSON.stringify({
            id: `batch_req_${completed + failed}`,
            custom_id: customId,
            response: {
              status_code: 200,
              request_id: rid,
              body: result,
            },
            error: null,
          }),
        );
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : "Batch request failed";
        outputLines.push(
          JSON.stringify({
            id: `batch_req_${completed + failed}`,
            custom_id: customId,
            response: null,
            error: { code: "batch_error", message },
          }),
        );
      }
    }

    const now = unixNow();
    const outputContent = `${outputLines.join("\n")}\n`;
    const outputFile = os().files.insert({
      file_id: fileId(),
      bytes: Buffer.byteLength(outputContent),
      created_unix: now,
      filename: "batch_output.jsonl",
      purpose: "batch",
      status: "processed",
      content: outputContent,
    });

    const id = batchId();
    const batch = os().batches.insert({
      batch_id: id,
      object: "batch",
      endpoint,
      errors: null,
      input_file_id: inputFileId,
      completion_window: completionWindow,
      status: "completed",
      output_file_id: outputFile.file_id,
      error_file_id: null,
      created_unix: now,
      in_progress_at: now,
      expires_at: now + 86400,
      finalizing_at: now,
      completed_at: now,
      failed_at: null,
      expired_at: null,
      cancelling_at: null,
      cancelled_at: null,
      request_counts: {
        total: lines.length,
        completed,
        failed,
      },
      metadata: (body.metadata as Record<string, string> | undefined) ?? null,
    });

    logRequest(os(), {
      request_id: rid,
      method: "POST",
      path: "/v1/batches",
      model: null,
      prompt_preview: inputFileId,
      reply_preview: `${completed}/${lines.length} completed`,
      prompt_tokens: 0,
      completion_tokens: 0,
      streamed: false,
    });

    return c.json(formatBatch(batch));
  });

  app.get("/v1/batches/:id", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const batch = os().batches.findOneBy("batch_id", c.req.param("id"));
    if (!batch) {
      return openaiError(c, 404, `No batch found with id '${c.req.param("id")}'`, "invalid_request_error", null, null);
    }
    return c.json(formatBatch(batch));
  });

  app.get("/v1/batches", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const after = c.req.query("after");
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100);
    let items = os()
      .batches.all()
      .sort((a, b) => b.created_unix - a.created_unix);
    if (after) {
      const idx = items.findIndex((b) => b.batch_id === after);
      items = idx >= 0 ? items.slice(idx + 1) : items;
    }
    const page = items.slice(0, limit);
    return c.json({
      object: "list",
      data: page.map(formatBatch),
      has_more: items.length > limit,
      first_id: page[0]?.batch_id ?? null,
      last_id: page[page.length - 1]?.batch_id ?? null,
    });
  });

  app.post("/v1/batches/:id/cancel", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const batch = os().batches.findOneBy("batch_id", c.req.param("id"));
    if (!batch) {
      return openaiError(c, 404, `No batch found with id '${c.req.param("id")}'`, "invalid_request_error", null, null);
    }

    if (batch.status === "completed" || batch.status === "failed" || batch.status === "cancelled") {
      return openaiError(
        c,
        400,
        `Cannot cancel batch with status '${batch.status}'`,
        "invalid_request_error",
        null,
        null,
      );
    }

    const now = unixNow();
    const updated = os().batches.update(batch.id, {
      status: "cancelled",
      cancelling_at: now,
      cancelled_at: now,
    })!;
    return c.json(formatBatch(updated));
  });
}

function formatBatch(batch: {
  batch_id: string;
  object: "batch";
  endpoint: string;
  errors: unknown;
  input_file_id: string;
  completion_window: string;
  status: string;
  output_file_id: string | null;
  error_file_id: string | null;
  created_unix: number;
  in_progress_at: number | null;
  expires_at: number | null;
  finalizing_at: number | null;
  completed_at: number | null;
  failed_at: number | null;
  expired_at: number | null;
  cancelling_at: number | null;
  cancelled_at: number | null;
  request_counts: { total: number; completed: number; failed: number };
  metadata: Record<string, string> | null;
}) {
  return {
    id: batch.batch_id,
    object: "batch" as const,
    endpoint: batch.endpoint,
    errors: batch.errors,
    input_file_id: batch.input_file_id,
    completion_window: batch.completion_window,
    status: batch.status,
    output_file_id: batch.output_file_id,
    error_file_id: batch.error_file_id,
    created_at: batch.created_unix,
    in_progress_at: batch.in_progress_at,
    expires_at: batch.expires_at,
    finalizing_at: batch.finalizing_at,
    completed_at: batch.completed_at,
    failed_at: batch.failed_at,
    expired_at: batch.expired_at,
    cancelling_at: batch.cancelling_at,
    cancelled_at: batch.cancelled_at,
    request_counts: batch.request_counts,
    metadata: batch.metadata,
  };
}

function processBatchRequest(os: OpenAIStore, url: string, body: Record<string, unknown>): unknown {
  if (url.includes("/embeddings")) {
    const model = String(body.model ?? "");
    if (!modelExists(os, model)) throw new Error(`model_not_found: ${model}`);
    const input = body.input;
    const texts = Array.isArray(input)
      ? input.map(String)
      : [typeof input === "string" ? input : String(input ?? "")];
    const dims = (body.dimensions as number | undefined) ?? defaultEmbeddingDims(model);
    let promptTokens = 0;
    const data = texts.map((text, index) => {
      promptTokens += estimateTokens(text);
      return {
        object: "embedding",
        index,
        embedding: deterministicEmbedding(text, dims),
      };
    });
    return {
      object: "list",
      data,
      model,
      usage: { prompt_tokens: promptTokens, total_tokens: promptTokens },
    };
  }

  const model = String(body.model ?? "");
  if (!modelExists(os, model)) throw new Error(`model_not_found: ${model}`);
  const messages = (body.messages as unknown[]) ?? [];
  const promptText = lastUserMessageText(messages);
  const reply = generateReply({
    model,
    content: promptText,
    matchers: os.responseMatchers.all(),
    tools: body.tools as unknown[] | undefined,
    toolChoice: body.tool_choice,
    responseFormat: body.response_format,
    maxTokens: (body.max_tokens as number | undefined) ?? (body.max_completion_tokens as number | undefined) ?? null,
  });
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(reply.content ?? JSON.stringify(reply.toolCalls ?? []));
  return {
    id: `chatcmpl_batch_${unixNow()}`,
    object: "chat.completion",
    created: unixNow(),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: reply.content,
          refusal: null,
          ...(reply.toolCalls ? { tool_calls: reply.toolCalls } : {}),
        },
        logprobs: null,
        finish_reason: reply.finishReason,
      },
    ],
    usage: usageDetails(promptTokens, completionTokens),
    system_fingerprint: "fp_emulate_openai",
  };
}
