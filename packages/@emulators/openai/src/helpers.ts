import { createHash, randomBytes } from "node:crypto";
import type { Context, ContentfulStatusCode } from "@emulators/core";
import type { OpenAIStore } from "./store.js";
import type { OpenAIResponseMatcher } from "./entities.js";

export function openaiId(prefix: string, length = 24): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `${prefix}${out}`;
}

export function chatCompletionId(): string {
  return openaiId("chatcmpl-", 24);
}

export function messageId(): string {
  return openaiId("msg_", 24);
}

export function responseId(): string {
  return openaiId("resp_", 24);
}

export function fileId(): string {
  return openaiId("file-", 24);
}

export function batchId(): string {
  return openaiId("batch_", 24);
}

export function toolCallId(): string {
  return openaiId("call_", 24);
}

export function requestId(): string {
  return `req_${randomBytes(12).toString("hex")}`;
}

export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

export function openaiError(
  c: Context,
  status: number,
  message: string,
  type: string = "invalid_request_error",
  code: string | null = null,
  param: string | null = null,
) {
  return c.json(
    {
      error: {
        message,
        type,
        param,
        code,
      },
    },
    status as ContentfulStatusCode,
  );
}

export function requireOpenAIAuth(c: Context, os: OpenAIStore): true | Response {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return openaiError(
      c,
      401,
      "Missing bearer authentication in Authorization header",
      "invalid_request_error",
      "invalid_api_key",
    );
  }

  const key = match[1];
  const seeded = os.apiKeys.all();
  if (seeded.length === 0) return true;

  const found = os.apiKeys.findOneBy("key", key);
  if (!found) {
    return openaiError(
      c,
      401,
      "Incorrect API key provided",
      "invalid_request_error",
      "invalid_api_key",
    );
  }
  return true;
}

export function applyOpenAIHeaders(c: Context): string {
  const rid = requestId();
  c.header("x-request-id", rid);

  const org = c.req.header("OpenAI-Organization");
  if (org) c.header("OpenAI-Organization", org);
  const project = c.req.header("OpenAI-Project");
  if (project) c.header("OpenAI-Project", project);

  return rid;
}

export async function parseJsonBody(c: Context): Promise<Record<string, unknown> | Response> {
  try {
    const body = await c.req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return openaiError(c, 400, "Invalid request body", "invalid_request_error");
  } catch {
    return openaiError(c, 400, "We could not parse the JSON body of your request", "invalid_request_error");
  }
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words * 1.3));
}

export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (part && typeof part === "object") {
      const p = part as Record<string, unknown>;
      if (typeof p.text === "string") parts.push(p.text);
      else if (typeof p.content === "string") parts.push(p.content);
      else if (p.type === "text" && typeof (p as { text?: string }).text === "string") {
        parts.push((p as { text: string }).text);
      } else if (p.type === "input_text" && typeof p.text === "string") {
        parts.push(p.text);
      } else if (p.type === "output_text" && typeof p.text === "string") {
        parts.push(p.text);
      }
    }
  }
  return parts.join("\n");
}

export function lastUserMessageText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (!msg) continue;
    if (msg.role === "user") return extractTextContent(msg.content);
  }
  return "";
}

export function extractInputText(input: unknown): string {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  const parts: string[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.content === "string") parts.push(row.content);
    else if (Array.isArray(row.content)) parts.push(extractTextContent(row.content));
    else if (typeof row.text === "string") parts.push(row.text);
  }
  return parts.join("\n");
}

export interface GeneratedReply {
  content: string | null;
  toolCalls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  finishReason: "stop" | "tool_calls" | "length";
}

export function findMatcher(
  matchers: OpenAIResponseMatcher[],
  model: string,
  content: string,
): OpenAIResponseMatcher | undefined {
  const ordered = [...matchers].sort((a, b) => a.order - b.order);
  for (const matcher of ordered) {
    if (matcher.match_model && matcher.match_model !== model) continue;
    if (matcher.content_contains && !content.includes(matcher.content_contains)) continue;
    return matcher;
  }
  return undefined;
}

export function generateReply(opts: {
  model: string;
  content: string;
  matchers: OpenAIResponseMatcher[];
  tools?: unknown[];
  toolChoice?: unknown;
  responseFormat?: unknown;
  maxTokens?: number | null;
}): GeneratedReply {
  const matcher = findMatcher(opts.matchers, opts.model, opts.content);

  const forceTool =
    opts.toolChoice === "required" ||
    (opts.toolChoice &&
      typeof opts.toolChoice === "object" &&
      (opts.toolChoice as { type?: string }).type === "function");

  const toolFromChoice =
    forceTool &&
    opts.toolChoice &&
    typeof opts.toolChoice === "object" &&
    (opts.toolChoice as { function?: { name?: string } }).function?.name
      ? {
          name: (opts.toolChoice as { function: { name: string } }).function.name,
          arguments: "{}",
        }
      : null;

  if (matcher?.tool_call_name || toolFromChoice) {
    const name = matcher?.tool_call_name ?? toolFromChoice!.name;
    const args = matcher?.tool_call_arguments ?? toolFromChoice!.arguments;
    return {
      content: null,
      toolCalls: [
        {
          id: toolCallId(),
          type: "function",
          function: {
            name,
            arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
          },
        },
      ],
      finishReason: "tool_calls",
    };
  }

  let content = matcher?.reply ?? defaultEchoReply(opts.content);

  const rf = opts.responseFormat as
    | { type?: string; json_schema?: { name?: string; schema?: Record<string, unknown> } }
    | undefined;
  if (rf?.type === "json_object") {
    try {
      JSON.parse(content);
    } catch {
      content = JSON.stringify({ message: content });
    }
  } else if (rf?.type === "json_schema" && rf.json_schema?.schema) {
    content = JSON.stringify(generateFromSchema(rf.json_schema.schema, content));
  }

  if (opts.maxTokens != null && opts.maxTokens > 0) {
    const words = content.split(/\s+/);
    if (words.length > opts.maxTokens) {
      return {
        content: words.slice(0, opts.maxTokens).join(" "),
        finishReason: "length",
      };
    }
  }

  return { content, finishReason: "stop" };
}

function defaultEchoReply(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "Hello! How can I help you today?";
  const preview = trimmed.length > 200 ? `${trimmed.slice(0, 200)}...` : trimmed;
  return `Emulated reply to: ${preview}`;
}

export function generateFromSchema(schema: Record<string, unknown>, seedText: string): Record<string, unknown> {
  const type = schema.type;
  if (type === "object" || schema.properties) {
    const props = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
    const required = (schema.required as string[]) ?? Object.keys(props);
    const out: Record<string, unknown> = {};
    for (const key of required) {
      const prop = props[key] ?? { type: "string" };
      out[key] = valueFromSchemaProp(prop, `${seedText}:${key}`);
    }
    return out;
  }
  return { value: seedText || "emulated" };
}

function valueFromSchemaProp(prop: Record<string, unknown>, seed: string): unknown {
  const type = prop.type;
  if (type === "string" || prop.enum) {
    if (Array.isArray(prop.enum) && prop.enum.length > 0) return prop.enum[0];
    return seed.slice(0, 40) || "emulated";
  }
  if (type === "number" || type === "integer") return 1;
  if (type === "boolean") return true;
  if (type === "array") {
    const items = (prop.items as Record<string, unknown>) ?? { type: "string" };
    return [valueFromSchemaProp(items, seed)];
  }
  if (type === "object" || prop.properties) {
    return generateFromSchema(prop, seed);
  }
  return null;
}

export function hashSeed(input: string): number {
  const digest = createHash("sha256").update(input).digest();
  return digest.readUInt32BE(0);
}

export function deterministicEmbedding(input: string, dimensions: number): number[] {
  const vec = new Array<number>(dimensions);
  let state = hashSeed(input);
  for (let i = 0; i < dimensions; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    vec[i] = (state / 0xffffffff) * 2 - 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dimensions; i++) vec[i] = vec[i] / norm;
  return vec;
}

export function embeddingToBase64(vec: number[]): string {
  const buf = Buffer.alloc(vec.length * 4);
  for (let i = 0; i < vec.length; i++) {
    buf.writeFloatLE(vec[i], i * 4);
  }
  return buf.toString("base64");
}

export function defaultEmbeddingDims(model: string): number {
  if (model.includes("3-large")) return 3072;
  return 1536;
}

export function preview(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function modelExists(os: OpenAIStore, model: string): boolean {
  return os.models.findOneBy("model_id", model) != null;
}

export function usageDetails(promptTokens: number, completionTokens: number) {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    prompt_tokens_details: {
      cached_tokens: 0,
      audio_tokens: 0,
    },
    completion_tokens_details: {
      reasoning_tokens: 0,
      audio_tokens: 0,
      accepted_prediction_tokens: 0,
      rejected_prediction_tokens: 0,
    },
  };
}

export function splitForStreaming(text: string, chunkSize = 12): string[] {
  if (!text) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks.length > 0 ? chunks : [""];
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export const DEFAULT_MODELS: Array<{ id: string; owned_by: string }> = [
  { id: "gpt-4o", owned_by: "openai" },
  { id: "gpt-4o-mini", owned_by: "openai" },
  { id: "gpt-4.1", owned_by: "openai" },
  { id: "gpt-4.1-mini", owned_by: "openai" },
  { id: "o3", owned_by: "openai" },
  { id: "o4-mini", owned_by: "openai" },
  { id: "text-embedding-3-small", owned_by: "openai" },
  { id: "text-embedding-3-large", owned_by: "openai" },
  { id: "text-embedding-ada-002", owned_by: "openai" },
  { id: "whisper-1", owned_by: "openai" },
  { id: "gpt-4o-transcribe", owned_by: "openai" },
  { id: "tts-1", owned_by: "openai" },
  { id: "gpt-4o-mini-tts", owned_by: "openai" },
  { id: "omni-moderation-latest", owned_by: "openai" },
];

export function logRequest(
  os: OpenAIStore,
  opts: {
    request_id: string;
    method: string;
    path: string;
    model: string | null;
    prompt_preview: string;
    reply_preview: string;
    prompt_tokens: number;
    completion_tokens: number;
    streamed: boolean;
  },
): void {
  os.requestLogs.insert({
    request_id: opts.request_id,
    method: opts.method,
    path: opts.path,
    model: opts.model,
    prompt_preview: preview(opts.prompt_preview),
    reply_preview: preview(opts.reply_preview),
    prompt_tokens: opts.prompt_tokens,
    completion_tokens: opts.completion_tokens,
    streamed: opts.streamed,
    created_unix: unixNow(),
  });
}
