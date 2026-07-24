import type { Entity } from "@emulators/core";

export type OpenPhoneMessageDirection = "incoming" | "outgoing";
export type OpenPhoneMessageStatus = "queued" | "sent" | "delivered" | "undelivered" | "received";
export type OpenPhoneCallDirection = "incoming" | "outgoing";
export type OpenPhoneCallStatus = "completed" | "missed" | "no-answer" | "ringing" | "in-progress";
export type OpenPhoneWebhookStatus = "enabled" | "disabled";
export type OpenPhoneWebhookType = "messages" | "calls" | "call-summaries" | "call-transcripts";

export interface OpenPhoneApiKey extends Entity {
  key: string;
  name: string;
  active: boolean;
}

export interface OpenPhoneUser extends Entity {
  openphone_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
}

export interface OpenPhonePhoneNumber extends Entity {
  openphone_id: string;
  group_id: string;
  name: string;
  number: string;
  symbol: string;
  user_ids: string[];
  restrictions: Record<string, unknown>;
  formatted_number: string | null;
  forward: string | null;
  port_request_id: string | null;
  porting_status: string | null;
}

export interface OpenPhoneMessage extends Entity {
  openphone_id: string;
  to: string[];
  from: string;
  text: string;
  phone_number_id: string;
  conversation_id: string;
  direction: OpenPhoneMessageDirection;
  user_id: string | null;
  status: OpenPhoneMessageStatus;
}

export interface OpenPhoneCallVoicemail {
  duration: number;
  type: string;
  url: string;
}

export interface OpenPhoneCall extends Entity {
  openphone_id: string;
  phone_number_id: string;
  user_id: string | null;
  direction: OpenPhoneCallDirection;
  participants: string[];
  status: OpenPhoneCallStatus;
  answered_at: string | null;
  answered_by: string | null;
  initiated_by: string | null;
  completed_at: string | null;
  duration: number;
  voicemail: OpenPhoneCallVoicemail | null;
  call_route: string | null;
  forwarded_from: string | null;
  forwarded_to: string | null;
  ai_handled: boolean;
}

export interface OpenPhoneRecording extends Entity {
  openphone_id: string;
  call_id: string;
  url: string;
  duration: number;
  type: string;
  start_time: string;
  status: string;
}

export interface OpenPhoneCallSummary extends Entity {
  call_id: string;
  summary: string[];
  next_steps: string[];
  status: string;
}

export interface OpenPhoneDialogueLine {
  content: string;
  start: number;
  end: number;
  identifier: string;
  user_id: string | null;
}

export interface OpenPhoneCallTranscript extends Entity {
  call_id: string;
  duration: number;
  status: string;
  dialogue: OpenPhoneDialogueLine[];
}

export interface OpenPhoneContactEmail {
  id: string;
  name: string;
  value: string | null;
}

export interface OpenPhoneContactPhone {
  id: string;
  name: string;
  value: string | null;
}

export interface OpenPhoneContactCustomField {
  id: string;
  key: string;
  value: string | null;
  name?: string;
  type?: string;
}

export interface OpenPhoneContact extends Entity {
  openphone_id: string;
  external_id: string | null;
  source: string | null;
  source_url: string | null;
  created_by_user_id: string | null;
  default_fields: {
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    role: string | null;
    emails: OpenPhoneContactEmail[];
    phoneNumbers: OpenPhoneContactPhone[];
  };
  custom_fields: OpenPhoneContactCustomField[];
}

export interface OpenPhoneCustomFieldDef extends Entity {
  key: string;
  name: string;
  field_type: string;
}

export interface OpenPhoneWebhook extends Entity {
  openphone_id: string;
  user_id: string;
  org_id: string;
  label: string | null;
  status: OpenPhoneWebhookStatus;
  url: string;
  key: string;
  events: string[];
  resource_ids: string[];
  webhook_type: OpenPhoneWebhookType;
  deleted_at: string | null;
}

export interface OpenPhoneWebhookDelivery extends Entity {
  event_id: string;
  webhook_id: string;
  event: string;
  url: string;
  request_body: unknown;
  request_headers: Record<string, string>;
  response_status: number | null;
  response_body: string | null;
  success: boolean;
  error: string | null;
}
