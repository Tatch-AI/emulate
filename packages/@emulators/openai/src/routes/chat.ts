import type { RouteContext } from "@emulators/core";
import { getOpenAIStore } from "../store.js";
import {
  applyOpenAIHeaders,
  chatCompletionId,
  estimateTokens,
  generateReply,
  lastUserMessageText,
  logRequest,
  modelExists,
  openaiError,
  parseJsonBody,
  requireOpenAIAuth,
  splitForStreaming,
  unixNow,
  usageDetails,
} from "../helpers.js";

export function chatRoutes({ app, store }: RouteContext): void {
  const os = () => getOpenAIStore(store);

  app.post("/v1/chat/completions", async (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    const rid = applyOpenAIHeaders(c);

    const bodyOrErr = await parseJsonBody(c);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const model = body.model as string | undefined;
    const messages = body.messages as unknown[] | undefined;
    if (!model) {
      return openaiError(c, 400, "Missing required parameter: 'model'", "invalid_request_error", null, "model");
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return openaiError(
        c,
        400,
        "Missing required parameter: 'messages'",
        "invalid_request_error",
        null,
        "messages",
      );
    }
    if (!modelExists(os(), model)) {
      return openaiError(c, 404, `The model '${model}' does not exist`, "invalid_request_error", "model_not_found", "model");
    }

    const promptText = lastUserMessageText(messages);
    const maxTokens =
      (body.max_completion_tokens as number | undefined) ?? (body.max_tokens as number | undefined) ?? null;
    const n = Math.max(1, Math.min(Number(body.n ?? 1) || 1, 10));
    const stream = Boolean(body.stream);
    const streamOptions = body.stream_options as { include_usage?: boolean } | undefined;
    const matchers = os().responseMatchers.all();

    const replies = Array.from({ length: n }, () =>
      generateReply({
        model,
        content: promptText,
        matchers,
        tools: body.tools as unknown[] | undefined,
        toolChoice: body.tool_choice,
        responseFormat: body.response_format,
        maxTokens,
      }),
    );

    const promptTokens = estimateTokens(
      messages.map((m) => lastUserMessageText([m]) || JSON.stringify(m)).join("\n"),
    );
    const completionTokens = replies.reduce(
      (sum, r) => sum + estimateTokens(r.content ?? JSON.stringify(r.toolCalls ?? [])),
      0,
    );

    const created = unixNow();
    const id = chatCompletionId();
    const systemFingerprint = "fp_emulate_openai";

    logRequest(os(), {
      request_id: rid,
      method: "POST",
      path: "/v1/chat/completions",
      model,
      prompt_preview: promptText,
      reply_preview: replies[0].content ?? JSON.stringify(replies[0].toolCalls ?? []),
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      streamed: stream,
    });

    if (stream) {
      const includeUsage = Boolean(streamOptions?.include_usage);
      const chunks: string[] = [];
      const primary = replies[0];

      chunks.push(
        sseData({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: primary.toolCalls ? null : "" },
              logprobs: null,
              finish_reason: null,
            },
          ],
        }),
      );

      if (primary.toolCalls) {
        for (const toolCall of primary.toolCalls) {
          chunks.push(
            sseData({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: systemFingerprint,
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: toolCall.id,
                        type: "function",
                        function: { name: toolCall.function.name, arguments: toolCall.function.arguments },
                      },
                    ],
                  },
                  logprobs: null,
                  finish_reason: null,
                },
              ],
            }),
          );
        }
      } else {
        for (const piece of splitForStreaming(primary.content ?? "")) {
          chunks.push(
            sseData({
              id,
              object: "chat.completion.chunk",
              created,
              model,
              system_fingerprint: systemFingerprint,
              choices: [
                {
                  index: 0,
                  delta: { content: piece },
                  logprobs: null,
                  finish_reason: null,
                },
              ],
            }),
          );
        }
      }

      chunks.push(
        sseData({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          system_fingerprint: systemFingerprint,
          choices: [
            {
              index: 0,
              delta: {},
              logprobs: null,
              finish_reason: primary.finishReason,
            },
          ],
        }),
      );

      if (includeUsage) {
        chunks.push(
          sseData({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            system_fingerprint: systemFingerprint,
            choices: [],
            usage: usageDetails(promptTokens, completionTokens),
          }),
        );
      }

      chunks.push("data: [DONE]\n\n");
      return c.body(chunks.join(""), 200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
    }

    const choices = replies.map((reply, index) => ({
      index,
      message: {
        role: "assistant" as const,
        content: reply.content,
        refusal: null,
        ...(reply.toolCalls ? { tool_calls: reply.toolCalls } : {}),
      },
      logprobs: body.logprobs ? { content: [] } : null,
      finish_reason: reply.finishReason,
    }));

    return c.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices,
      usage: usageDetails(promptTokens, completionTokens),
      system_fingerprint: systemFingerprint,
    });
  });
}

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
