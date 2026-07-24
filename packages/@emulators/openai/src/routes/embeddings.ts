import type { RouteContext } from "@emulators/core";
import { getOpenAIStore } from "../store.js";
import {
  applyOpenAIHeaders,
  defaultEmbeddingDims,
  deterministicEmbedding,
  embeddingToBase64,
  estimateTokens,
  logRequest,
  modelExists,
  openaiError,
  parseJsonBody,
  requireOpenAIAuth,
} from "../helpers.js";

export function embeddingRoutes({ app, store }: RouteContext): void {
  const os = () => getOpenAIStore(store);

  app.post("/v1/embeddings", async (c) => {
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

    const encodingFormat = ((body.encoding_format as string | undefined) ?? "float") as "float" | "base64";
    const dims = (body.dimensions as number | undefined) ?? defaultEmbeddingDims(model);
    const inputs = normalizeInputs(body.input);
    if (inputs.length === 0) {
      return openaiError(c, 400, "'input' is empty", "invalid_request_error", null, "input");
    }

    let promptTokens = 0;
    const data = inputs.map((text, index) => {
      promptTokens += estimateTokens(text);
      const embedding = deterministicEmbedding(text, dims);
      return {
        object: "embedding" as const,
        index,
        embedding: encodingFormat === "base64" ? embeddingToBase64(embedding) : embedding,
      };
    });

    logRequest(os(), {
      request_id: rid,
      method: "POST",
      path: "/v1/embeddings",
      model,
      prompt_preview: inputs[0],
      reply_preview: `dims=${dims} n=${inputs.length}`,
      prompt_tokens: promptTokens,
      completion_tokens: 0,
      streamed: false,
    });

    return c.json({
      object: "list",
      data,
      model,
      usage: {
        prompt_tokens: promptTokens,
        total_tokens: promptTokens,
      },
    });
  });
}

function normalizeInputs(input: unknown): string[] {
  if (typeof input === "string") return [input];
  if (Array.isArray(input)) {
    if (input.length === 0) return [];
    if (typeof input[0] === "number") return [input.join(",")];
    return input.map((item) => {
      if (typeof item === "string") return item;
      if (Array.isArray(item)) return item.join(",");
      return String(item);
    });
  }
  return [String(input)];
}
