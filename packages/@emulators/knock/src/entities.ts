import type { Entity } from "@emulators/core";

export type KnockChannelType = "in_app_feed" | "email" | "sms" | "push" | "chat";

export type KnockMessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "undelivered"
  | "not_sent"
  | "delivery_attempted"
  | "bounced";

export type KnockEngagementStatus = "seen" | "read" | "interacted" | "archived" | "link_clicked";

export interface KnockApiKey extends Entity {
  key: string;
  name: string;
  type: "secret" | "public";
}

export interface KnockChannel extends Entity {
  channel_id: string;
  key: string;
  type: KnockChannelType;
  name: string;
}

export interface KnockWorkflowStep {
  channel: string;
  template: {
    subject?: string;
    body?: string;
  };
}

export interface KnockWorkflow extends Entity {
  key: string;
  name: string;
  steps: KnockWorkflowStep[];
  version_id: string;
}

export interface KnockUser extends Entity {
  user_id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  avatar: string | null;
  properties: Record<string, unknown>;
}

export interface KnockTenant extends Entity {
  tenant_id: string;
  name: string | null;
  settings: Record<string, unknown>;
  properties: Record<string, unknown>;
}

export interface KnockObject extends Entity {
  collection: string;
  object_id: string;
  properties: Record<string, unknown>;
}

export interface KnockSubscription extends Entity {
  subscription_id: string;
  collection: string;
  object_id: string;
  recipient_id: string;
  properties: Record<string, unknown>;
}

export interface KnockPreferenceSet extends Entity {
  user_id: string;
  preference_id: string;
  categories: Record<string, unknown>;
  channel_types: Record<string, unknown>;
  workflows: Record<string, unknown>;
}

export interface KnockMessage extends Entity {
  message_id: string;
  channel_id: string;
  channel_type: KnockChannelType;
  recipient: string | { id: string; collection: string };
  recipient_user_id: string | null;
  workflow_key: string;
  workflow_version_id: string;
  tenant: string | null;
  status: KnockMessageStatus;
  engagement_statuses: KnockEngagementStatus[];
  seen_at: string | null;
  read_at: string | null;
  interacted_at: string | null;
  archived_at: string | null;
  clicked_at: string | null;
  link_clicked_at: string | null;
  data: Record<string, unknown>;
  actors: Array<string | { id: string; collection: string }>;
  content: {
    subject?: string | null;
    body?: string | null;
    html_body?: string | null;
    text_body?: string | null;
    blocks?: Array<{ content: string; name: string; rendered: string; type: string }>;
  };
  workflow_run_id: string;
  cancellation_key: string | null;
  interaction_metadata: Record<string, unknown> | null;
}

export interface KnockMessageEvent extends Entity {
  event_id: string;
  message_id: string;
  type: string;
  data: Record<string, unknown>;
  inserted_at: string;
}

export interface KnockWorkflowRun extends Entity {
  workflow_run_id: string;
  workflow_key: string;
  status: "running" | "completed" | "canceled";
  recipients: Array<string | { id: string; collection: string }>;
  actor: string | { id: string; collection: string } | null;
  tenant: string | null;
  data: Record<string, unknown>;
  cancellation_key: string | null;
  message_ids: string[];
}

export interface KnockBulkOperation extends Entity {
  bulk_id: string;
  name: string;
  status: "queued" | "processing" | "completed" | "failed";
  estimated_total_rows: number;
  processed_rows: number;
  success_count: number;
  error_count: number;
  completed_at: string | null;
  started_at: string | null;
}
