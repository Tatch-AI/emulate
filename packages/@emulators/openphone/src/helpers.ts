import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Context, ContentfulStatusCode } from "@emulators/core";
import type {
  OpenPhoneCall,
  OpenPhoneCallSummary,
  OpenPhoneCallTranscript,
  OpenPhoneContact,
  OpenPhoneMessage,
  OpenPhonePhoneNumber,
  OpenPhoneRecording,
  OpenPhoneWebhook,
  OpenPhoneWebhookType,
} from "./entities.js";
import type { OpenPhoneStore } from "./store.js";

export const DOCS_URL = "https://www.openphone.com/docs";
export const DEFAULT_ORG_ID = "OR00000000";
export const DEFAULT_API_KEY = "op_test_api_key";
export const DEFAULT_USER_ID = "US00000000";
export const DEFAULT_PHONE_NUMBER_ID = "PN00000000";
export const DEFAULT_PHONE_NUMBER = "+15551234567";
export const DEFAULT_USER_EMAIL = "owner@example.com";

export function openPhoneId(prefix: string, length = 16): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let out = prefix;
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function fixedId(prefix: string, length = 8): string {
  return `${prefix}${"0".repeat(length)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function generateWebhookKey(): string {
  return randomBytes(32).toString("base64");
}

export function openPhoneError(
  c: Context,
  status: number,
  title: string,
  message: string,
  code?: string,
  errors?: Array<{ path: string; message: string; value?: unknown }>,
) {
  return c.json(
    {
      message,
      code: code ?? String(status),
      status,
      docs: DOCS_URL,
      title,
      errors: errors ?? [],
    },
    status as ContentfulStatusCode,
  );
}

export function extractApiKey(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const bearer = trimmed.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  return trimmed;
}

export function requireOpenPhoneAuth(c: Context, ops: OpenPhoneStore): true | Response {
  const key = extractApiKey(c);
  if (!key) {
    return openPhoneError(c, 401, "Unauthorized", "Requires authentication", "unauthorized");
  }
  const seeded = ops.apiKeys.all().filter((item) => item.active);
  if (seeded.length === 0) return true;
  const match = seeded.find((item) => constantTimeEqual(item.key, key));
  if (!match) {
    return openPhoneError(c, 401, "Unauthorized", "Invalid API key", "unauthorized");
  }
  return true;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function normalizeE164(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\+[1-9]\d{1,14}$/.test(trimmed)) return trimmed;
  return null;
}

export function resolvePhoneNumber(
  ops: OpenPhoneStore,
  from: string,
): OpenPhonePhoneNumber | null {
  if (from.startsWith("PN")) {
    return ops.phoneNumbers.findOneBy("openphone_id", from) ?? null;
  }
  const e164 = normalizeE164(from);
  if (!e164) return null;
  return ops.phoneNumbers.findOneBy("number", e164) ?? null;
}

export function parseMaxResults(c: Context, fallback = 10, max = 100): number {
  const raw = c.req.query("maxResults");
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function parsePageToken(c: Context): number {
  const token = c.req.query("pageToken");
  if (!token) return 0;
  const n = Number(token);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function listEnvelope<T>(items: T[], maxResults: number, offset: number) {
  const totalItems = items.length;
  const page = items.slice(offset, offset + maxResults);
  const nextOffset = offset + maxResults;
  return {
    data: page,
    totalItems,
    nextPageToken: nextOffset < totalItems ? String(nextOffset) : null,
  };
}

export function queryParticipants(c: Context): string[] {
  const values = c.req.queries("participants") ?? c.req.queries("participants[]") ?? [];
  const single = c.req.query("participants");
  if (values.length > 0) return values;
  if (single) return [single];
  return [];
}

export function queryStringArray(c: Context, name: string): string[] {
  const values = c.req.queries(name) ?? c.req.queries(`${name}[]`) ?? [];
  const single = c.req.query(name);
  if (values.length > 0) return values;
  if (single) return [single];
  return [];
}

export async function parseJson(c: Context): Promise<Record<string, unknown> | Response> {
  try {
    const body = await c.req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return openPhoneError(c, 400, "Validation Error", "Request body must be a JSON object", "validation");
  } catch {
    return openPhoneError(c, 400, "Validation Error", "Problems parsing JSON", "validation");
  }
}

export function formatMessage(message: OpenPhoneMessage) {
  return {
    id: message.openphone_id,
    to: message.to,
    from: message.from,
    text: message.text,
    phoneNumberId: message.phone_number_id,
    conversationId: message.conversation_id,
    direction: message.direction,
    userId: message.user_id,
    status: message.status,
    createdAt: message.created_at,
    updatedAt: message.updated_at,
  };
}

export function formatCall(call: OpenPhoneCall) {
  return {
    id: call.openphone_id,
    phoneNumberId: call.phone_number_id,
    userId: call.user_id,
    direction: call.direction,
    participants: call.participants,
    status: call.status,
    answeredAt: call.answered_at,
    answeredBy: call.answered_by,
    initiatedBy: call.initiated_by,
    completedAt: call.completed_at,
    createdAt: call.created_at,
    updatedAt: call.updated_at,
    duration: call.duration,
    voicemail: call.voicemail,
    callRoute: call.call_route,
    forwardedFrom: call.forwarded_from,
    forwardedTo: call.forwarded_to,
    aiHandled: call.ai_handled,
  };
}

export function formatRecording(recording: OpenPhoneRecording) {
  return {
    id: recording.openphone_id,
    url: recording.url,
    duration: recording.duration,
    type: recording.type,
    startTime: recording.start_time,
    status: recording.status,
  };
}

export function formatSummary(summary: OpenPhoneCallSummary) {
  return {
    callId: summary.call_id,
    summary: summary.summary,
    nextSteps: summary.next_steps,
    status: summary.status,
  };
}

export function formatTranscript(transcript: OpenPhoneCallTranscript) {
  return {
    callId: transcript.call_id,
    duration: transcript.duration,
    status: transcript.status,
    createdAt: transcript.created_at,
    dialogue: transcript.dialogue.map((line) => ({
      content: line.content,
      start: line.start,
      end: line.end,
      identifier: line.identifier,
      userId: line.user_id,
    })),
  };
}

export function formatContact(contact: OpenPhoneContact) {
  return {
    id: contact.openphone_id,
    externalId: contact.external_id,
    source: contact.source,
    sourceUrl: contact.source_url,
    createdByUserId: contact.created_by_user_id,
    defaultFields: contact.default_fields,
    customFields: contact.custom_fields,
    createdAt: contact.created_at,
    updatedAt: contact.updated_at,
  };
}

export function formatPhoneNumber(ops: OpenPhoneStore, number: OpenPhonePhoneNumber) {
  const users = number.user_ids
    .map((id) => ops.users.findOneBy("openphone_id", id))
    .filter(Boolean)
    .map((user) => ({
      id: user!.openphone_id,
      firstName: user!.first_name,
      lastName: user!.last_name,
      email: user!.email,
      role: user!.role,
    }));
  return {
    id: number.openphone_id,
    groupId: number.group_id,
    name: number.name,
    number: number.number,
    symbol: number.symbol,
    users,
    restrictions: number.restrictions,
    formattedNumber: number.formatted_number,
    forward: number.forward,
    portRequestId: number.port_request_id,
    portingStatus: number.porting_status,
    createdAt: number.created_at,
    updatedAt: number.updated_at,
  };
}

export function formatWebhook(webhook: OpenPhoneWebhook) {
  return {
    id: webhook.openphone_id,
    userId: webhook.user_id,
    orgId: webhook.org_id,
    label: webhook.label,
    status: webhook.status,
    url: webhook.url,
    key: webhook.key,
    createdAt: webhook.created_at,
    updatedAt: webhook.updated_at,
    deletedAt: webhook.deleted_at,
    events: webhook.events,
    resourceIds: webhook.resource_ids,
    type: webhook.webhook_type,
  };
}

export function conversationIdFor(phoneNumberId: string, participants: string[]): string {
  const key = `${phoneNumberId}:${[...participants].sort().join(",")}`;
  const digest = createHmac("sha256", "openphone-conversation").update(key).digest("hex").slice(0, 16);
  return `CN${digest}`;
}

export function signOpenPhoneWebhook(timestamp: string, body: string, keyBase64: string): string {
  const secret = Buffer.from(keyBase64, "base64");
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("base64");
  return `hmac;1;${timestamp};${signature}`;
}

export function verifyOpenPhoneSignature(header: string, body: string, keyBase64: string): boolean {
  const parts = header.split(";");
  if (parts.length !== 4 || parts[0] !== "hmac" || parts[1] !== "1") return false;
  const timestamp = parts[2];
  const expected = signOpenPhoneWebhook(timestamp, body, keyBase64);
  return constantTimeEqual(header, expected);
}

export async function dispatchOpenPhoneEvent(
  ops: OpenPhoneStore,
  eventType: string,
  resourcePhoneNumberId: string | null,
  object: unknown,
  webhookTypes?: OpenPhoneWebhookType[],
): Promise<void> {
  const eventId = openPhoneId("EV", 20);
  const createdAt = isoNow();
  const payload = {
    id: eventId,
    object: "event",
    createdAt,
    apiVersion: "v4",
    type: eventType,
    data: { object },
  };
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());

  const candidates = ops.webhooks
    .all()
    .filter((hook) => hook.status === "enabled" && !hook.deleted_at)
    .filter((hook) => !webhookTypes || webhookTypes.includes(hook.webhook_type))
    .filter((hook) => hook.events.includes(eventType) || hook.events.includes("*"))
    .filter((hook) => {
      if (hook.resource_ids.includes("*")) return true;
      if (!resourcePhoneNumberId) return hook.resource_ids.length === 0 || hook.resource_ids.includes("*");
      return hook.resource_ids.includes(resourcePhoneNumberId);
    });

  for (const hook of candidates) {
    const signature = signOpenPhoneWebhook(timestamp, body, hook.key);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "openphone-signature": signature,
    };
    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let success = false;
    let error: string | null = null;

    try {
      const response = await fetch(hook.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      responseStatus = response.status;
      responseBody = await response.text();
      success = response.ok;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    ops.webhookDeliveries.insert({
      event_id: eventId,
      webhook_id: hook.openphone_id,
      event: eventType,
      url: hook.url,
      request_body: payload,
      request_headers: headers,
      response_status: responseStatus,
      response_body: responseBody,
      success,
      error,
    });
  }
}

export function maskSecret(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function defaultUserId(ops: OpenPhoneStore): string {
  return ops.users.all()[0]?.openphone_id ?? DEFAULT_USER_ID;
}
