import { randomBytes, randomUUID } from "node:crypto";
import type { Context, ContentfulStatusCode } from "@emulators/core";
import type { KnockStore } from "./store.js";
import type {
  KnockEngagementStatus,
  KnockMessage,
  KnockPreferenceSet,
  KnockUser,
  KnockChannelType,
} from "./entities.js";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generateUuid(): string {
  return randomUUID();
}

/** Knock-style ksuid-like id (27 base62 chars). */
export function generateKsuid(): string {
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < 27; i++) {
    out += BASE62[bytes[i % bytes.length] % BASE62.length];
  }
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function knockError(
  c: Context,
  status: number,
  code: string,
  message: string,
  type?: string,
  errors?: Array<{ field: string; message: string }>,
) {
  const body: Record<string, unknown> = {
    code,
    message,
    status,
    type: type ?? (status === 401 ? "authentication_error" : status === 404 ? "api_error" : "invalid_request_error"),
  };
  if (errors) body.errors = errors;
  return c.json(body, status as ContentfulStatusCode);
}

export function extractBearer(c: Context): string | null {
  const header = c.req.header("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * Server API auth: require Bearer secret key when any keys are seeded.
 * Accepts any non-empty Bearer token when no keys are seeded (repo convention).
 */
export function requireSecretAuth(c: Context, ks: KnockStore): true | Response {
  const token = extractBearer(c);
  if (!token) {
    return knockError(c, 401, "authentication_error", "Invalid authentication credentials", "authentication_error");
  }

  const seeded = ks.apiKeys.all().filter((k) => k.type === "secret");
  if (seeded.length === 0) return true;

  const found = seeded.find((k) => k.key === token);
  if (!found) {
    return knockError(c, 401, "authentication_error", "Invalid authentication credentials", "authentication_error");
  }
  return true;
}

/**
 * Feed/client auth: accept public key, secret key, or no auth (documented relaxation).
 * When public keys are seeded and a Bearer token is present, validate it.
 */
export function requireFeedAuth(c: Context, ks: KnockStore): true | Response {
  const token = extractBearer(c);
  if (!token) return true;

  const seeded = ks.apiKeys.all();
  if (seeded.length === 0) return true;

  const found = seeded.find((k) => k.key === token);
  if (!found) {
    return knockError(c, 401, "authentication_error", "Invalid authentication credentials", "authentication_error");
  }
  return true;
}

export async function parseKnockBody(c: Context): Promise<Record<string, unknown> | Response> {
  try {
    const body = await c.req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return knockError(c, 422, "invalid_params", "Request body must be an object", "invalid_request_error");
  } catch {
    return knockError(c, 422, "invalid_params", "Could not parse JSON body", "invalid_request_error");
  }
}

export function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value) && typeof out[key] === "object" && out[key] !== null && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function resolvePath(ctx: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = ctx;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Render `{{ var }}` / `{{ recipient.name }}` style templates. */
export function renderTemplate(template: string | undefined | null, ctx: Record<string, unknown>): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expr: string) => {
    const value = resolvePath(ctx, expr.trim());
    if (value == null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  });
}

export interface PageInfo {
  __typename: "PageInfo";
  page_size: number;
  after: string | null;
  before: string | null;
}

export function paginateByCursor<T>(
  items: T[],
  getCursor: (item: T) => string,
  opts: { page_size?: number; after?: string | null; before?: string | null },
): { page: T[]; page_info: PageInfo } {
  const pageSize = Math.min(Math.max(opts.page_size ?? 50, 1), 100);
  let start = 0;
  if (opts.after) {
    const idx = items.findIndex((item) => getCursor(item) === opts.after);
    start = idx >= 0 ? idx + 1 : items.length;
  }
  const page = items.slice(start, start + pageSize);
  const after = page.length === pageSize && start + pageSize < items.length ? getCursor(page[page.length - 1]) : null;
  return {
    page,
    page_info: {
      __typename: "PageInfo",
      page_size: pageSize,
      after,
      before: null,
    },
  };
}

export function formatUser(user: KnockUser): Record<string, unknown> {
  return {
    id: user.user_id,
    name: user.name,
    email: user.email,
    phone_number: user.phone_number,
    avatar: user.avatar,
    created_at: user.created_at,
    updated_at: user.updated_at,
    __typename: "User",
    ...user.properties,
  };
}

export function formatMessage(msg: KnockMessage): Record<string, unknown> {
  return {
    id: msg.message_id,
    __typename: "Message",
    channel_id: msg.channel_id,
    recipient: msg.recipient,
    workflow: msg.workflow_key,
    tenant: msg.tenant,
    status: msg.status,
    engagement_statuses: msg.engagement_statuses,
    seen_at: msg.seen_at,
    read_at: msg.read_at,
    interacted_at: msg.interacted_at,
    archived_at: msg.archived_at,
    clicked_at: msg.clicked_at,
    link_clicked_at: msg.link_clicked_at,
    inserted_at: msg.created_at,
    updated_at: msg.updated_at,
    source: {
      __typename: "WorkflowSource",
      key: msg.workflow_key,
      version_id: msg.workflow_version_id,
      categories: [],
    },
    data: msg.data,
    actors: msg.actors,
  };
}

export function formatPreferenceSet(pref: KnockPreferenceSet): Record<string, unknown> {
  return {
    id: pref.preference_id,
    categories: pref.categories,
    channel_types: pref.channel_types,
    workflows: pref.workflows,
    __typename: "PreferenceSet",
  };
}

export function formatBulkOperation(op: {
  bulk_id: string;
  name: string;
  status: string;
  estimated_total_rows: number;
  processed_rows: number;
  success_count: number;
  error_count: number;
  completed_at: string | null;
  started_at: string | null;
  created_at: string;
  updated_at: string;
}): Record<string, unknown> {
  return {
    id: op.bulk_id,
    __typename: "BulkOperation",
    name: op.name,
    status: op.status,
    estimated_total_rows: op.estimated_total_rows,
    processed_rows: op.processed_rows,
    success_count: op.success_count,
    error_count: op.error_count,
    completed_at: op.completed_at,
    started_at: op.started_at,
    inserted_at: op.created_at,
    updated_at: op.updated_at,
  };
}

function channelTypeEnabled(value: unknown): boolean {
  if (value === false) return false;
  if (value && typeof value === "object" && "enabled" in (value as object)) {
    return (value as { enabled?: boolean }).enabled !== false;
  }
  return true;
}

/** Returns false when the channel step should be skipped for this recipient. */
export function isChannelAllowed(
  pref: KnockPreferenceSet | undefined,
  workflowKey: string,
  channelType: KnockChannelType,
): boolean {
  if (!pref) return true;

  const workflowPref = pref.workflows?.[workflowKey];
  if (workflowPref === false) return false;
  if (workflowPref && typeof workflowPref === "object") {
    const nested = workflowPref as { channel_types?: Record<string, unknown> };
    if (nested.channel_types && channelType in nested.channel_types) {
      return channelTypeEnabled(nested.channel_types[channelType]);
    }
  }

  if (pref.channel_types && channelType in pref.channel_types) {
    return channelTypeEnabled(pref.channel_types[channelType]);
  }

  return true;
}

function addStatus(list: KnockEngagementStatus[], status: KnockEngagementStatus): KnockEngagementStatus[] {
  if (list.includes(status)) return list;
  return [...list, status];
}

function removeStatus(list: KnockEngagementStatus[], status: KnockEngagementStatus): KnockEngagementStatus[] {
  return list.filter((s) => s !== status);
}

export type EngagementAction =
  | "seen"
  | "unseen"
  | "read"
  | "unread"
  | "interacted"
  | "archived"
  | "unarchived";

export function applyEngagement(
  msg: KnockMessage,
  action: EngagementAction,
  metadata?: Record<string, unknown> | null,
): Partial<KnockMessage> {
  const ts = nowIso();
  switch (action) {
    case "seen":
      return {
        engagement_statuses: addStatus(msg.engagement_statuses, "seen"),
        seen_at: msg.seen_at ?? ts,
      };
    case "unseen":
      return {
        engagement_statuses: removeStatus(removeStatus(msg.engagement_statuses, "seen"), "read"),
        seen_at: null,
        read_at: null,
      };
    case "read":
      return {
        engagement_statuses: addStatus(addStatus(msg.engagement_statuses, "seen"), "read"),
        seen_at: msg.seen_at ?? ts,
        read_at: msg.read_at ?? ts,
      };
    case "unread":
      return {
        engagement_statuses: removeStatus(msg.engagement_statuses, "read"),
        read_at: null,
      };
    case "interacted":
      return {
        engagement_statuses: addStatus(
          addStatus(addStatus(msg.engagement_statuses, "seen"), "read"),
          "interacted",
        ),
        seen_at: msg.seen_at ?? ts,
        read_at: msg.read_at ?? ts,
        interacted_at: msg.interacted_at ?? ts,
        interaction_metadata: metadata ?? msg.interaction_metadata,
      };
    case "archived":
      return {
        engagement_statuses: addStatus(msg.engagement_statuses, "archived"),
        archived_at: msg.archived_at ?? ts,
      };
    case "unarchived":
      return {
        engagement_statuses: removeStatus(msg.engagement_statuses, "archived"),
        archived_at: null,
      };
  }
}

export function appendMessageEvent(
  ks: KnockStore,
  messageId: string,
  type: string,
  data: Record<string, unknown> = {},
): void {
  ks.messageEvents.insert({
    event_id: generateKsuid(),
    message_id: messageId,
    type,
    data,
    inserted_at: nowIso(),
  });
}

export function resolveChannel(
  ks: KnockStore,
  ref: string,
): { channel_id: string; type: KnockChannelType; name: string } | undefined {
  const byId = ks.channels.findOneBy("channel_id", ref);
  if (byId) return { channel_id: byId.channel_id, type: byId.type, name: byId.name };
  const byKey = ks.channels.findOneBy("key", ref);
  if (byKey) return { channel_id: byKey.channel_id, type: byKey.type, name: byKey.name };
  return undefined;
}

export function upsertUser(
  ks: KnockStore,
  userId: string,
  data: Record<string, unknown> = {},
): KnockUser {
  const existing = ks.users.findOneBy("user_id", userId);
  const reserved = new Set(["id", "name", "email", "phone_number", "avatar", "created_at", "updated_at", "__typename"]);
  const properties: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!reserved.has(k)) properties[k] = v;
  }

  if (existing) {
    const mergedProps = deepMerge(existing.properties, properties);
    return (
      ks.users.update(existing.id, {
        name: (data.name as string | undefined) ?? existing.name,
        email: (data.email as string | undefined) ?? existing.email,
        phone_number: (data.phone_number as string | undefined) ?? existing.phone_number,
        avatar: (data.avatar as string | undefined) ?? existing.avatar,
        properties: mergedProps,
      }) ?? existing
    );
  }

  return ks.users.insert({
    user_id: userId,
    name: (data.name as string | null | undefined) ?? null,
    email: (data.email as string | null | undefined) ?? null,
    phone_number: (data.phone_number as string | null | undefined) ?? null,
    avatar: (data.avatar as string | null | undefined) ?? null,
    properties,
  });
}
