import type { Entity } from "@emulators/core";

export type StopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface TextContentBlock {
  type: "text";
  text: string;
  citations: null;
}

export interface ThinkingContentBlock {
  type: "thinking";
  thinking: string;
  signature: string;
}

export interface ToolUseContentBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
  caller: { type: "direct" };
}

export type ContentBlock = TextContentBlock | ThinkingContentBlock | ToolUseContentBlock;

export interface AnthropicMessage {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: ContentBlock[];
  stop_reason: StopReason | null;
  stop_sequence: string | null;
  stop_details: null;
  container: null;
  usage: AnthropicUsage;
}

export interface AnthropicModel extends Entity {
  model_id: string;
  display_name: string;
  created_at_iso: string;
  alias_of: string | null;
}

export interface AnthropicApiKey extends Entity {
  key: string;
  name: string;
}

export interface AnthropicRequestLog extends Entity {
  request_id: string;
  kind: "messages" | "count_tokens";
  model: string;
  prompt_preview: string;
  reply_preview: string;
  stop_reason: string | null;
  input_tokens: number;
  output_tokens: number;
  streamed: boolean;
}

export interface BatchResultLine {
  custom_id: string;
  result:
    | { type: "succeeded"; message: AnthropicMessage }
    | { type: "errored"; error: { type: string; message: string } }
    | { type: "canceled" }
    | { type: "expired" };
}

export interface AnthropicBatch extends Entity {
  batch_id: string;
  processing_status: "in_progress" | "canceling" | "ended";
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  created_at_iso: string;
  ended_at_iso: string | null;
  expires_at_iso: string;
  cancel_initiated_at_iso: string | null;
  archived_at_iso: string | null;
  results_url: string | null;
  results: BatchResultLine[];
}

export interface ResponseMatcher {
  match?: {
    model?: string;
    content_contains?: string;
  };
  reply?: string;
  tool_call?: {
    name: string;
    input: Record<string, unknown>;
  };
}

export interface AnthropicSeedConfig {
  port?: number;
  api_keys?: Array<string | { key: string; name?: string }>;
  models?: Array<{ id: string; display_name?: string; alias_of?: string }>;
  responses?: ResponseMatcher[];
}
