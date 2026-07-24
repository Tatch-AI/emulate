import type { Entity } from "@emulators/core";

export interface OpenAIModel extends Entity {
  model_id: string;
  created: number;
  owned_by: string;
}

export interface OpenAIApiKey extends Entity {
  key: string;
  name: string;
}

export interface OpenAIFile extends Entity {
  file_id: string;
  bytes: number;
  created_unix: number;
  filename: string;
  purpose: string;
  status: "processed" | "uploaded" | "error" | "deleted";
  content: string;
  content_base64?: string;
}

export interface OpenAIBatch extends Entity {
  batch_id: string;
  object: "batch";
  endpoint: string;
  errors: unknown;
  input_file_id: string;
  completion_window: string;
  status: "validating" | "in_progress" | "finalizing" | "completed" | "failed" | "expired" | "cancelling" | "cancelled";
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
  request_counts: {
    total: number;
    completed: number;
    failed: number;
  };
  metadata: Record<string, string> | null;
}

export interface OpenAIResponseRecord extends Entity {
  response_id: string;
  created_unix: number;
  status: string;
  model: string;
  output: unknown[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
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
  stored: boolean;
  raw: Record<string, unknown>;
}

export interface OpenAIRequestLog extends Entity {
  request_id: string;
  method: string;
  path: string;
  model: string | null;
  prompt_preview: string;
  reply_preview: string;
  prompt_tokens: number;
  completion_tokens: number;
  streamed: boolean;
  created_unix: number;
}

export interface OpenAIResponseMatcher extends Entity {
  match_model: string | null;
  content_contains: string | null;
  reply: string;
  tool_call_name: string | null;
  tool_call_arguments: string | null;
  order: number;
}

export interface OpenAITranscriptSeed extends Entity {
  filename_contains: string | null;
  text: string;
}

export interface OpenAIModerationTrigger extends Entity {
  contains: string;
  categories: string[];
}
