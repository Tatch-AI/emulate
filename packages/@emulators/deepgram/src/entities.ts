import type { Entity } from "@emulators/core";

export interface DeepgramProject extends Entity {
  project_id: string;
  name: string;
  company: string | null;
}

export interface DeepgramApiKey extends Entity {
  api_key_id: string;
  key: string;
  project_id: string;
  comment: string;
  scopes: string[];
  created: string;
  expiration_date: string | null;
  member_id: string;
  member_email: string;
}

export interface DeepgramMember extends Entity {
  member_id: string;
  project_id: string;
  email: string;
  first_name: string;
  last_name: string;
  scopes: string[];
}

export interface DeepgramTempToken extends Entity {
  access_token: string;
  expires_at: number;
  expires_in: number;
  api_key_id: string | null;
}

export interface DeepgramTranscriptMatcher {
  match?: { url_contains?: string; text_contains?: string };
  text: string;
  duration?: number;
  speakers?: number;
  summary?: string;
}

export interface DeepgramListenRequest extends Entity {
  request_id: string;
  project_id: string | null;
  model: string;
  source: string;
  source_url: string | null;
  transcript: string;
  duration: number;
  features: Record<string, unknown>;
  response_code: number;
  callback: string | null;
  created: string;
}

export interface DeepgramSpeakRequest extends Entity {
  request_id: string;
  project_id: string | null;
  model: string;
  text: string;
  char_count: number;
  encoding: string;
  container: string;
  response_code: number;
  created: string;
}

export interface DeepgramReadRequest extends Entity {
  request_id: string;
  project_id: string | null;
  text_preview: string;
  source: string;
  features: Record<string, unknown>;
  response_code: number;
  created: string;
}

export interface DeepgramUsageRequest extends Entity {
  request_id: string;
  project_id: string;
  created: string;
  path: string;
  code: number;
  duration_hours: number;
  api_key_id: string | null;
}

export interface DeepgramCallbackDelivery extends Entity {
  delivery_id: string;
  request_id: string;
  url: string;
  status_code: number | null;
  success: boolean;
  error: string | null;
  headers: Record<string, string>;
  payload: unknown;
  delivered_at: string;
}
