import type { RouteContext } from "@emulators/core";
import { getKnockStore } from "../store.js";
import {
  appendMessageEvent,
  applyEngagement,
  formatBulkOperation,
  formatMessage,
  generateKsuid,
  knockError,
  nowIso,
  paginateByCursor,
  parseKnockBody,
  requireSecretAuth,
  type EngagementAction,
} from "../helpers.js";
import type { KnockMessage } from "../entities.js";

const BATCH_STATUSES = new Set([
  "seen",
  "unseen",
  "read",
  "unread",
  "interacted",
  "archived",
  "unarchived",
]);

const CHANNEL_BULK_STATUSES = new Set([
  "seen",
  "unseen",
  "read",
  "unread",
  "interacted",
  "archived",
  "unarchived",
  "archive",
  "unarchive",
]);

function normalizeAction(status: string): EngagementAction | null {
  if (status === "archive") return "archived";
  if (status === "unarchive") return "unarchived";
  if (BATCH_STATUSES.has(status)) return status as EngagementAction;
  return null;
}

function updateMessageStatus(
  ks: ReturnType<typeof getKnockStore>,
  msg: KnockMessage,
  action: EngagementAction,
  metadata?: Record<string, unknown> | null,
): KnockMessage {
  const patch = applyEngagement(msg, action, metadata);
  const updated = ks.messages.update(msg.id, patch) ?? msg;
  appendMessageEvent(ks, msg.message_id, `message.${action}`, metadata ?? {});
  return updated;
}

export function messageRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ks = () => getKnockStore(store);

  app.get("/v1/messages", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    let msgs = ks()
      .messages.all()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const channelId = c.req.query("channel_id");
    if (channelId) msgs = msgs.filter((m) => m.channel_id === channelId);
    const workflow = c.req.query("workflow");
    if (workflow) msgs = msgs.filter((m) => m.workflow_key === workflow);
    const tenant = c.req.query("tenant");
    if (tenant) msgs = msgs.filter((m) => m.tenant === tenant);

    const statuses = c.req.queries("status") ?? (c.req.query("status") ? [c.req.query("status")!] : undefined);
    if (statuses && statuses.length > 0) {
      const set = new Set(statuses);
      msgs = msgs.filter((m) => set.has(m.status));
    }

    const pageSize = Number(c.req.query("page_size") ?? 50);
    const after = c.req.query("after") ?? null;
    const { page, page_info } = paginateByCursor(msgs, (m) => m.message_id, { page_size: pageSize, after });
    return c.json({ items: page.map(formatMessage), page_info });
  });

  app.post("/v1/messages/batch/:status", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const status = c.req.param("status");
    const action = normalizeAction(status);
    if (!action) {
      return knockError(c, 422, "invalid_params", `Invalid batch status: ${status}`, "invalid_request_error");
    }

    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const ids = body.message_ids;
    if (!Array.isArray(ids)) {
      return knockError(c, 422, "invalid_params", "Missing required field: message_ids", "invalid_request_error", [
        { field: "message_ids", message: "must be an array" },
      ]);
    }

    const metadata = (body.metadata as Record<string, unknown> | undefined) ?? null;
    const updated: KnockMessage[] = [];
    for (const id of ids) {
      const msg = ks().messages.findOneBy("message_id", String(id));
      if (!msg) continue;
      updated.push(updateMessageStatus(ks(), msg, action, metadata));
    }

    return c.json(updated.map(formatMessage));
  });

  app.post("/v1/channels/:channel_id/messages/bulk/:status", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const channelId = c.req.param("channel_id");
    const status = c.req.param("status");
    if (!CHANNEL_BULK_STATUSES.has(status)) {
      return knockError(c, 422, "invalid_params", `Invalid bulk status: ${status}`, "invalid_request_error");
    }
    const action = normalizeAction(status)!;

    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const userIds = (body.user_ids as string[] | undefined) ?? (body.recipient_ids as string[] | undefined);
    const userFilter = userIds ? new Set(userIds) : null;

    let msgs = ks()
      .messages.all()
      .filter((m) => m.channel_id === channelId || resolveChannelKey(ks(), channelId, m));

    if (userFilter) {
      msgs = msgs.filter((m) => m.recipient_user_id != null && userFilter.has(m.recipient_user_id));
    }

    for (const msg of msgs) {
      updateMessageStatus(ks(), msg, action);
    }

    const started = nowIso();
    const op = ks().bulkOperations.insert({
      bulk_id: generateKsuid(),
      name: `messages.${action}`,
      status: "completed",
      estimated_total_rows: msgs.length,
      processed_rows: msgs.length,
      success_count: msgs.length,
      error_count: 0,
      completed_at: started,
      started_at: started,
    });

    return c.json(formatBulkOperation(op));
  });

  app.get("/v1/messages/:id", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const msg = ks().messages.findOneBy("message_id", c.req.param("id"));
    if (!msg) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");
    return c.json(formatMessage(msg));
  });

  app.get("/v1/messages/:id/content", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const msg = ks().messages.findOneBy("message_id", c.req.param("id"));
    if (!msg) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");

    if (msg.channel_type === "email") {
      return c.json({
        __typename: "MessageEmailContent",
        subject: msg.content.subject,
        html_body: msg.content.html_body ?? msg.content.body,
        text_body: msg.content.text_body ?? msg.content.body,
        to: [],
        from: null,
        cc: null,
        bcc: null,
        reply_to: null,
      });
    }
    if (msg.channel_type === "sms") {
      return c.json({
        __typename: "MessageSMSContent",
        body: msg.content.body,
        to: null,
      });
    }
    return c.json({
      __typename: "MessageInAppFeedContent",
      blocks: msg.content.blocks ?? [
        { content: msg.content.body ?? "", name: "body", rendered: msg.content.body ?? "", type: "markdown" },
      ],
    });
  });

  app.get("/v1/messages/:id/events", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const msg = ks().messages.findOneBy("message_id", c.req.param("id"));
    if (!msg) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");

    const events = ks()
      .messageEvents.all()
      .filter((e) => e.message_id === msg.message_id)
      .sort((a, b) => a.inserted_at.localeCompare(b.inserted_at));

    const pageSize = Number(c.req.query("page_size") ?? 50);
    const after = c.req.query("after") ?? null;
    const { page, page_info } = paginateByCursor(events, (e) => e.event_id, { page_size: pageSize, after });

    return c.json({
      items: page.map((e) => ({
        id: e.event_id,
        __typename: "MessageEvent",
        type: e.type,
        data: e.data,
        inserted_at: e.inserted_at,
      })),
      page_info,
    });
  });

  for (const action of ["seen", "read", "interacted", "archived"] as const) {
    app.put(`/v1/messages/:id/${action}`, async (c) => {
      const auth = requireSecretAuth(c, ks());
      if (auth !== true) return auth;

      const msg = ks().messages.findOneBy("message_id", c.req.param("id"));
      if (!msg) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");

      let metadata: Record<string, unknown> | null = null;
      if (action === "interacted") {
        const body = await parseKnockBody(c);
        if (body instanceof Response) return body;
        metadata = (body.metadata as Record<string, unknown> | undefined) ?? null;
      }

      const updated = updateMessageStatus(ks(), msg, action, metadata);
      return c.json(formatMessage(updated));
    });
  }

  for (const [path, action] of [
    ["seen", "unseen"],
    ["read", "unread"],
    ["archived", "unarchived"],
  ] as const) {
    app.delete(`/v1/messages/:id/${path}`, (c) => {
      const auth = requireSecretAuth(c, ks());
      if (auth !== true) return auth;

      const msg = ks().messages.findOneBy("message_id", c.req.param("id"));
      if (!msg) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");

      const updated = updateMessageStatus(ks(), msg, action);
      return c.json(formatMessage(updated));
    });
  }
}

function resolveChannelKey(
  ks: ReturnType<typeof getKnockStore>,
  channelRef: string,
  msg: KnockMessage,
): boolean {
  if (msg.channel_id === channelRef) return true;
  const ch = ks.channels.findOneBy("key", channelRef) ?? ks.channels.findOneBy("channel_id", channelRef);
  return ch != null && ch.channel_id === msg.channel_id;
}
