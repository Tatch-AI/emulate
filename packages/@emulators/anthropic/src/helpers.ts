import { randomBytes } from "node:crypto";
import type { Context, ContentfulStatusCode, Next } from "@emulators/core";
import type { AnthropicStore } from "./store.js";
import type { ContentBlock, AnthropicMessage, AnthropicUsage, StopReason } from "./entities.js";

const ALNUM = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function randomAlnum(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALNUM[bytes[i]! % ALNUM.length]!;
  }
  return out;
}

export function generateMessageId(): string {
  return `msg_${randomAlnum(24)}`;
}

export function generateToolUseId(): string {
  return `toolu_${randomAlnum(24)}`;
}

export function generateBatchId(): string {
  return `msgbatch_${randomAlnum(24)}`;
}

export function generateRequestId(): string {
  return `req_${randomAlnum(24)}`;
}

export type AnthropicErrorType =
  | "authentication_error"
  | "not_found_error"
  | "invalid_request_error"
  | "rate_limit_error";

export function anthropicError(
  c: Context,
  status: number,
  type: AnthropicErrorType,
  message: string,
  requestId?: string,
) {
  const rid = requestId ?? generateRequestId();
  c.header("request-id", rid);
  return c.json(
    {
      type: "error",
      error: { type, message },
      request_id: rid,
    },
    status as ContentfulStatusCode,
  );
}

export function withRequestId(c: Context, requestId?: string): string {
  const rid = requestId ?? generateRequestId();
  c.header("request-id", rid);
  return rid;
}

export function extractApiKey(c: Context): string | null {
  const xApiKey = c.req.header("x-api-key");
  if (xApiKey && xApiKey.trim()) return xApiKey.trim();

  const auth = c.req.header("Authorization") ?? c.req.header("authorization");
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export function requireAnthropicAuth(c: Context, as: AnthropicStore): Response | null {
  const key = extractApiKey(c);
  if (!key) {
    return anthropicError(c, 401, "authentication_error", "Invalid authentication credentials");
  }

  const configured = as.apiKeys.all();
  if (configured.length === 0) return null;

  const found = as.apiKeys.findOneBy("key", key);
  if (!found) {
    return anthropicError(c, 401, "authentication_error", "Invalid API key");
  }
  return null;
}

export function requireAnthropicVersion(c: Context): Response | null {
  const version = c.req.header("anthropic-version");
  if (!version || !version.trim()) {
    return anthropicError(c, 400, "invalid_request_error", "anthropic-version: Field required");
  }
  return null;
}

export function anthropicApiGuard(as: () => AnthropicStore) {
  return async (c: Context, next: Next) => {
    const versionErr = requireAnthropicVersion(c);
    if (versionErr) return versionErr;
    const authErr = requireAnthropicAuth(c, as());
    if (authErr) return authErr;
    withRequestId(c);
    await next();
  };
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "tool_result") {
      if (typeof b.content === "string") parts.push(b.content);
      else if (Array.isArray(b.content)) parts.push(contentToText(b.content));
    } else if (b.type === "tool_use" && typeof b.name === "string") {
      parts.push(`[tool_use:${b.name}]`);
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      parts.push(b.thinking);
    }
  }
  return parts.join("\n");
}

export function lastUserText(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown> | undefined;
    if (msg?.role === "user") return contentToText(msg.content);
  }
  return "";
}

export function systemToText(system: unknown): string {
  if (typeof system === "string") return system;
  return contentToText(system);
}

export function estimateInputTokens(params: {
  model?: string;
  messages?: unknown[];
  system?: unknown;
  tools?: unknown[];
}): number {
  let total = 0;
  if (params.model) total += estimateTokens(params.model);
  if (params.system) total += estimateTokens(systemToText(params.system));
  if (Array.isArray(params.messages)) {
    for (const msg of params.messages) {
      const m = msg as Record<string, unknown>;
      total += estimateTokens(String(m.role ?? ""));
      total += estimateTokens(contentToText(m.content));
    }
  }
  if (Array.isArray(params.tools)) {
    total += estimateTokens(JSON.stringify(params.tools));
  }
  return Math.max(1, total);
}

export function makeUsage(inputTokens: number, outputTokens: number): AnthropicUsage {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

export function textBlock(text: string): ContentBlock {
  return { type: "text", text, citations: null };
}

export function thinkingBlock(thinking: string, signature?: string): ContentBlock {
  return {
    type: "thinking",
    thinking,
    signature: signature ?? `sig_${randomAlnum(32)}`,
  };
}

export function toolUseBlock(name: string, input: Record<string, unknown>, id?: string): ContentBlock {
  return {
    type: "tool_use",
    id: id ?? generateToolUseId(),
    name,
    input,
    caller: { type: "direct" },
  };
}

export function replyPreviewFromContent(content: ContentBlock[]): string {
  const texts = content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text);
  if (texts.length > 0) return texts.join(" ").slice(0, 200);
  const tools = content.filter((b) => b.type === "tool_use") as Extract<ContentBlock, { type: "tool_use" }>[];
  if (tools.length > 0) return `tool_use:${tools[0]!.name}`;
  const thinking = content.find((b) => b.type === "thinking") as
    | Extract<ContentBlock, { type: "thinking" }>
    | undefined;
  if (thinking) return thinking.thinking.slice(0, 200);
  return "";
}

export function outputTokensFromContent(content: ContentBlock[]): number {
  let text = "";
  for (const block of content) {
    if (block.type === "text") text += block.text;
    else if (block.type === "thinking") text += block.thinking;
    else if (block.type === "tool_use") text += JSON.stringify(block.input);
  }
  return estimateTokens(text || " ");
}

export function applyStopSequences(
  text: string,
  stopSequences: string[] | undefined,
): { text: string; stopReason: StopReason; stopSequence: string | null } {
  if (!stopSequences || stopSequences.length === 0) {
    return { text, stopReason: "end_turn", stopSequence: null };
  }
  let earliest = -1;
  let matched: string | null = null;
  for (const seq of stopSequences) {
    if (!seq) continue;
    const idx = text.indexOf(seq);
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
      matched = seq;
    }
  }
  if (earliest === -1 || matched == null) {
    return { text, stopReason: "end_turn", stopSequence: null };
  }
  return {
    text: text.slice(0, earliest),
    stopReason: "stop_sequence",
    stopSequence: matched,
  };
}

export function applyMaxTokens(
  text: string,
  maxTokens: number,
  currentStop: StopReason,
  currentSeq: string | null,
): { text: string; stopReason: StopReason; stopSequence: string | null } {
  const maxChars = Math.max(0, maxTokens * 4);
  if (text.length <= maxChars) {
    return { text, stopReason: currentStop, stopSequence: currentSeq };
  }
  return {
    text: text.slice(0, maxChars),
    stopReason: "max_tokens",
    stopSequence: null,
  };
}

export function buildMessage(opts: {
  id?: string;
  model: string;
  content: ContentBlock[];
  stopReason: StopReason | null;
  stopSequence: string | null;
  usage: AnthropicUsage;
}): AnthropicMessage {
  return {
    id: opts.id ?? generateMessageId(),
    type: "message",
    role: "assistant",
    model: opts.model,
    content: opts.content,
    stop_reason: opts.stopReason,
    stop_sequence: opts.stopSequence,
    stop_details: null,
    container: null,
    usage: opts.usage,
  };
}

export async function parseJsonBody(c: Context): Promise<Record<string, unknown> | Response> {
  try {
    const body = await c.req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return anthropicError(c, 400, "invalid_request_error", "Request body must be an object");
  } catch {
    return anthropicError(c, 400, "invalid_request_error", "Problems parsing JSON");
  }
}

export function paginateById<T extends { id: string }>(
  items: T[],
  opts: { before_id?: string; after_id?: string; limit?: number },
): { data: T[]; first_id: string | null; last_id: string | null; has_more: boolean } {
  const limit = Math.min(1000, Math.max(1, opts.limit ?? 20));
  let start = 0;
  let end = items.length;

  if (opts.after_id) {
    const idx = items.findIndex((item) => item.id === opts.after_id);
    start = idx === -1 ? items.length : idx + 1;
  }
  if (opts.before_id) {
    const idx = items.findIndex((item) => item.id === opts.before_id);
    end = idx === -1 ? 0 : idx;
  }

  const window = items.slice(start, end);
  const data = window.slice(0, limit);
  const has_more = window.length > limit;
  return {
    data,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
    has_more,
  };
}

export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function chunkText(text: string, chunkSize = 12): string[] {
  if (!text) return [""];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

export function chunkJson(json: string, chunkSize = 20): string[] {
  return chunkText(json, chunkSize);
}
