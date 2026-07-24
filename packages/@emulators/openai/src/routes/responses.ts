import type { RouteContext } from "@emulators/core";
import { getOpenAIStore } from "../store.js";
import {
  applyOpenAIHeaders,
  estimateTokens,
  extractInputText,
  generateReply,
  logRequest,
  messageId,
  modelExists,
  openaiError,
  parseJsonBody,
  requireOpenAIAuth,
  responseId,
  splitForStreaming,
  unixNow,
} from "../helpers.js";

export function responseRoutes({ app, store }: RouteContext): void {
  const os = () => getOpenAIStore(store);

  app.post("/v1/responses", async (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    const rid = applyOpenAIHeaders(c);

    const bodyOrErr = await parseJsonBody(c);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const model = body.model as string | undefined;
    if (!model) {
      return openaiError(c, 400, "Missing required parameter: 'model'", "invalid_request_error", null, "model");
    }
    if (body.input === undefined || body.input === null) {
      return openaiError(c, 400, "Missing required parameter: 'input'", "invalid_request_error", null, "input");
    }
    if (!modelExists(os(), model)) {
      return openaiError(c, 404, `The model '${model}' does not exist`, "invalid_request_error", "model_not_found", "model");
    }

    const inputText = extractInputText(body.input);
    const instructions = (body.instructions as string | undefined) ?? null;
    const combined = [instructions, inputText].filter(Boolean).join("\n");
    const stream = Boolean(body.stream);
    const shouldStore = body.store !== false;
    const matchers = os().responseMatchers.all();

    const reply = generateReply({
      model,
      content: combined,
      matchers,
      tools: body.tools as unknown[] | undefined,
      toolChoice: body.tool_choice,
      maxTokens: (body.max_output_tokens as number | undefined) ?? null,
    });

    const inputTokens = estimateTokens(combined);
    const outputTokens = estimateTokens(reply.content ?? JSON.stringify(reply.toolCalls ?? []));
    const createdAt = unixNow();
    const id = responseId();
    const msgId = messageId();
    const text = reply.content ?? "";

    const outputItem = reply.toolCalls
      ? {
          type: "function_call",
          id: msgId,
          status: "completed",
          call_id: reply.toolCalls[0].id,
          name: reply.toolCalls[0].function.name,
          arguments: reply.toolCalls[0].function.arguments,
        }
      : {
          type: "message",
          id: msgId,
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text,
              annotations: [],
            },
          ],
        };

    const responseObj = {
      id,
      object: "response" as const,
      created_at: createdAt,
      status: "completed" as const,
      model,
      output: [outputItem],
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
      instructions,
      temperature: (body.temperature as number | undefined) ?? null,
      top_p: (body.top_p as number | undefined) ?? null,
      parallel_tool_calls: body.parallel_tool_calls !== false,
      tool_choice: body.tool_choice ?? "auto",
      tools: (body.tools as unknown[]) ?? [],
      metadata: (body.metadata as Record<string, string>) ?? {},
      previous_response_id: (body.previous_response_id as string | undefined) ?? null,
      max_output_tokens: (body.max_output_tokens as number | undefined) ?? null,
      error: null,
      incomplete_details: null,
    };

    if (shouldStore) {
      os().responses.insert({
        response_id: id,
        created_unix: createdAt,
        status: "completed",
        model,
        output: responseObj.output,
        usage: responseObj.usage,
        instructions,
        temperature: responseObj.temperature,
        top_p: responseObj.top_p,
        parallel_tool_calls: responseObj.parallel_tool_calls,
        tool_choice: responseObj.tool_choice,
        tools: responseObj.tools,
        metadata: responseObj.metadata,
        previous_response_id: responseObj.previous_response_id,
        max_output_tokens: responseObj.max_output_tokens,
        error: null,
        incomplete_details: null,
        stored: true,
        raw: responseObj as unknown as Record<string, unknown>,
      });
    }

    logRequest(os(), {
      request_id: rid,
      method: "POST",
      path: "/v1/responses",
      model,
      prompt_preview: inputText,
      reply_preview: text || JSON.stringify(reply.toolCalls ?? []),
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      streamed: stream,
    });

    if (stream) {
      const events = buildResponseStreamEvents(responseObj, text);
      return c.body(events, 200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
    }

    return c.json(responseObj);
  });

  app.get("/v1/responses/:id", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const record = os().responses.findOneBy("response_id", c.req.param("id"));
    if (!record || !record.stored) {
      return openaiError(
        c,
        404,
        `No response found with id '${c.req.param("id")}'`,
        "invalid_request_error",
        null,
        null,
      );
    }
    return c.json(formatStoredResponse(record));
  });

  app.delete("/v1/responses/:id", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const record = os().responses.findOneBy("response_id", c.req.param("id"));
    if (!record) {
      return openaiError(
        c,
        404,
        `No response found with id '${c.req.param("id")}'`,
        "invalid_request_error",
        null,
        null,
      );
    }
    os().responses.delete(record.id);
    return c.json({ id: record.response_id, object: "response", deleted: true });
  });
}

function formatStoredResponse(record: {
  response_id: string;
  created_unix: number;
  status: string;
  model: string;
  output: unknown[];
  usage: { input_tokens: number; output_tokens: number; total_tokens: number };
  instructions: string | null;
  temperature: number | null;
  top_p: number | null;
  parallel_tool_calls: boolean;
  tool_choice: unknown;
  tools: unknown[];
  metadata: Record<string, string>;
  previous_response_id: string | null;
  max_output_tokens: number | null;
  error: null;
  incomplete_details: null;
  raw: Record<string, unknown>;
}) {
  if (record.raw && Object.keys(record.raw).length > 0) return record.raw;
  return {
    id: record.response_id,
    object: "response",
    created_at: record.created_unix,
    status: record.status,
    model: record.model,
    output: record.output,
    usage: record.usage,
    instructions: record.instructions,
    temperature: record.temperature,
    top_p: record.top_p,
    parallel_tool_calls: record.parallel_tool_calls,
    tool_choice: record.tool_choice,
    tools: record.tools,
    metadata: record.metadata,
    previous_response_id: record.previous_response_id,
    max_output_tokens: record.max_output_tokens,
    error: null,
    incomplete_details: null,
  };
}

function buildResponseStreamEvents(
  response: {
    id: string;
    object: "response";
    created_at: number;
    status: "completed";
    model: string;
    output: unknown[];
    usage: { input_tokens: number; output_tokens: number; total_tokens: number };
    instructions: string | null;
    temperature: number | null;
    top_p: number | null;
    parallel_tool_calls: boolean;
    tool_choice: unknown;
    tools: unknown[];
    metadata: Record<string, string>;
    previous_response_id: string | null;
    max_output_tokens: number | null;
    error: null;
    incomplete_details: null;
  },
  text: string,
): string {
  const item = response.output[0] as Record<string, unknown>;
  const parts: string[] = [];
  const push = (event: string, data: unknown) => {
    parts.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const base = { ...response, status: "in_progress" as const };

  push("response.created", { type: "response.created", response: { ...base, status: "in_progress", output: [] } });
  push("response.in_progress", {
    type: "response.in_progress",
    response: { ...base, status: "in_progress", output: [] },
  });

  push("response.output_item.added", {
    type: "response.output_item.added",
    output_index: 0,
    item: { ...item, status: "in_progress", content: item.type === "message" ? [] : undefined },
  });

  if (item.type === "message") {
    const part = { type: "output_text", text: "", annotations: [] };
    push("response.content_part.added", {
      type: "response.content_part.added",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part,
    });

    let acc = "";
    for (const delta of splitForStreaming(text)) {
      acc += delta;
      push("response.output_text.delta", {
        type: "response.output_text.delta",
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta,
      });
    }

    push("response.output_text.done", {
      type: "response.output_text.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: acc,
    });

    push("response.content_part.done", {
      type: "response.content_part.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: acc, annotations: [] },
    });
  }

  push("response.output_item.done", {
    type: "response.output_item.done",
    output_index: 0,
    item,
  });

  push("response.completed", {
    type: "response.completed",
    response,
  });

  return parts.join("");
}
