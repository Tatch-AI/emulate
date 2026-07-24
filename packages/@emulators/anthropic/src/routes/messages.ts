import type { RouteContext } from "@emulators/core";
import { getAnthropicStore } from "../store.js";
import { generateAssistantMessage, resolveModelId, validateMessagesRequest } from "../generate.js";
import {
  anthropicError,
  chunkJson,
  chunkText,
  contentToText,
  estimateInputTokens,
  lastUserText,
  makeUsage,
  parseJsonBody,
  replyPreviewFromContent,
  sseEvent,
  withRequestId,
} from "../helpers.js";
import type { AnthropicMessage, ContentBlock } from "../entities.js";

function recordLog(
  store: RouteContext["store"],
  opts: {
    requestId: string;
    kind: "messages" | "count_tokens";
    model: string;
    promptPreview: string;
    replyPreview: string;
    stopReason: string | null;
    inputTokens: number;
    outputTokens: number;
    streamed: boolean;
  },
): void {
  getAnthropicStore(store).requestLogs.insert({
    request_id: opts.requestId,
    kind: opts.kind,
    model: opts.model,
    prompt_preview: opts.promptPreview.slice(0, 200),
    reply_preview: opts.replyPreview.slice(0, 200),
    stop_reason: opts.stopReason,
    input_tokens: opts.inputTokens,
    output_tokens: opts.outputTokens,
    streamed: opts.streamed,
  });
}

function streamMessage(message: AnthropicMessage): string {
  const parts: string[] = [];
  const skeleton: AnthropicMessage = {
    ...message,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: makeUsage(message.usage.input_tokens, 0),
  };

  parts.push(sseEvent("message_start", { type: "message_start", message: skeleton }));

  let index = 0;
  for (const block of message.content) {
    if (block.type === "thinking") {
      parts.push(
        sseEvent("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "thinking", thinking: "", signature: "" },
        }),
      );
      for (const chunk of chunkText(block.thinking)) {
        parts.push(
          sseEvent("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "thinking_delta", thinking: chunk },
          }),
        );
      }
      parts.push(
        sseEvent("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "signature_delta", signature: block.signature },
        }),
      );
      parts.push(sseEvent("content_block_stop", { type: "content_block_stop", index }));
      index++;
      continue;
    }

    if (block.type === "tool_use") {
      parts.push(
        sseEvent("content_block_start", {
          type: "content_block_start",
          index,
          content_block: {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: {},
            caller: { type: "direct" },
          },
        }),
      );
      if (index === 0) {
        parts.push(sseEvent("ping", { type: "ping" }));
      }
      const json = JSON.stringify(block.input);
      for (const chunk of chunkJson(json)) {
        parts.push(
          sseEvent("content_block_delta", {
            type: "content_block_delta",
            index,
            delta: { type: "input_json_delta", partial_json: chunk },
          }),
        );
      }
      parts.push(sseEvent("content_block_stop", { type: "content_block_stop", index }));
      index++;
      continue;
    }

    // text
    parts.push(
      sseEvent("content_block_start", {
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "", citations: null },
      }),
    );
    if (index === 0) {
      parts.push(sseEvent("ping", { type: "ping" }));
    }
    for (const chunk of chunkText(block.text)) {
      parts.push(
        sseEvent("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: chunk },
        }),
      );
    }
    parts.push(sseEvent("content_block_stop", { type: "content_block_stop", index }));
    index++;
  }

  // Ensure ping appears even for empty content
  if (message.content.length === 0) {
    parts.push(
      sseEvent("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "", citations: null },
      }),
    );
    parts.push(sseEvent("ping", { type: "ping" }));
    parts.push(sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }));
  }

  parts.push(
    sseEvent("message_delta", {
      type: "message_delta",
      delta: {
        stop_reason: message.stop_reason,
        stop_sequence: message.stop_sequence,
        stop_details: null,
        container: null,
      },
      usage: { output_tokens: message.usage.output_tokens },
    }),
  );
  parts.push(sseEvent("message_stop", { type: "message_stop" }));
  return parts.join("");
}

export function createMessageFromBody(
  store: RouteContext["store"],
  body: Record<string, unknown>,
): { message: AnthropicMessage } | { error: { status: number; type: "invalid_request_error" | "not_found_error"; message: string } } {
  const validated = validateMessagesRequest(body);
  if (!validated.ok) {
    return {
      error: {
        status: validated.status ?? 400,
        type: validated.type ?? "invalid_request_error",
        message: validated.message,
      },
    };
  }

  if (!resolveModelId(store, validated.params.model)) {
    return {
      error: {
        status: 404,
        type: "not_found_error",
        message: `model: ${validated.params.model}`,
      },
    };
  }

  const message = generateAssistantMessage(store, validated.params);
  return { message };
}

export function messageRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;

  app.post("/v1/messages", async (c) => {
    const requestId = withRequestId(c);
    const bodyOrErr = await parseJsonBody(c);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const result = createMessageFromBody(store, body);
    if ("error" in result) {
      return anthropicError(c, result.error.status, result.error.type, result.error.message, requestId);
    }

    const { message } = result;
    const stream = Boolean(body.stream);
    const prompt = lastUserText((body.messages as unknown[]) ?? []);

    recordLog(store, {
      requestId,
      kind: "messages",
      model: String(body.model ?? message.model),
      promptPreview: prompt,
      replyPreview: replyPreviewFromContent(message.content as ContentBlock[]),
      stopReason: message.stop_reason,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      streamed: stream,
    });

    if (stream) {
      const payload = streamMessage(message);
      return c.body(payload, 200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "request-id": requestId,
      });
    }

    return c.json(message);
  });

  app.post("/v1/messages/count_tokens", async (c) => {
    const requestId = withRequestId(c);
    const bodyOrErr = await parseJsonBody(c);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    if (body.model == null || body.model === "") {
      return anthropicError(c, 400, "invalid_request_error", "model: Field required", requestId);
    }
    if (body.messages == null) {
      return anthropicError(c, 400, "invalid_request_error", "messages: Field required", requestId);
    }
    if (!resolveModelId(store, String(body.model))) {
      return anthropicError(c, 404, "not_found_error", `model: ${body.model}`, requestId);
    }

    const input_tokens = estimateInputTokens({
      model: String(body.model),
      messages: body.messages as unknown[],
      system: body.system,
      tools: body.tools as unknown[] | undefined,
    });

    const prompt = Array.isArray(body.messages) ? lastUserText(body.messages as unknown[]) : "";
    recordLog(store, {
      requestId,
      kind: "count_tokens",
      model: String(body.model),
      promptPreview: prompt || contentToText(body.system),
      replyPreview: `input_tokens=${input_tokens}`,
      stopReason: null,
      inputTokens: input_tokens,
      outputTokens: 0,
      streamed: false,
    });

    return c.json({ input_tokens });
  });
}
