import type { RouteContext } from "@emulators/core";
import { getKnockStore } from "../store.js";
import {
  appendMessageEvent,
  generateKsuid,
  generateUuid,
  isChannelAllowed,
  knockError,
  parseKnockBody,
  renderTemplate,
  requireSecretAuth,
  resolveChannel,
  upsertUser,
} from "../helpers.js";
import type { KnockMessage, KnockUser } from "../entities.js";

type RecipientRef = string | { id: string; collection?: string; [key: string]: unknown };

function isObjectRef(r: RecipientRef): r is { id: string; collection: string } {
  return typeof r === "object" && r !== null && typeof r.collection === "string" && typeof r.id === "string";
}

function isInlineUser(r: RecipientRef): r is { id: string; collection?: undefined; [key: string]: unknown } {
  return typeof r === "object" && r !== null && typeof r.id === "string" && !("collection" in r && r.collection);
}

function recipientKey(r: RecipientRef): string {
  if (typeof r === "string") return r;
  if (isObjectRef(r)) return `${r.collection}:${r.id}`;
  return String(r.id);
}

function createMessageForRecipient(opts: {
  ks: ReturnType<typeof getKnockStore>;
  workflowKey: string;
  versionId: string;
  runId: string;
  cancellationKey: string | null;
  tenant: string | null;
  data: Record<string, unknown>;
  actor: RecipientRef | null;
  channelRef: string;
  template: { subject?: string; body?: string };
  recipient: RecipientRef;
  user: KnockUser | null;
}): KnockMessage | null {
  const { ks } = opts;
  const channel = resolveChannel(ks, opts.channelRef);
  if (!channel) return null;

  if (opts.user) {
    const pref = ks.preferences.all().find((p) => p.user_id === opts.user!.user_id && p.preference_id === "default");
    if (!isChannelAllowed(pref, opts.workflowKey, channel.type)) return null;
  }

  const recipientCtx =
    opts.user != null
      ? {
          id: opts.user.user_id,
          name: opts.user.name,
          email: opts.user.email,
          phone_number: opts.user.phone_number,
          avatar: opts.user.avatar,
          ...opts.user.properties,
        }
      : typeof opts.recipient === "object"
        ? opts.recipient
        : { id: opts.recipient };

  const actorCtx =
    opts.actor == null
      ? null
      : typeof opts.actor === "string"
        ? (() => {
            const u = ks.users.findOneBy("user_id", opts.actor as string);
            return u
              ? { id: u.user_id, name: u.name, email: u.email, ...u.properties }
              : { id: opts.actor };
          })()
        : opts.actor;

  const tenantCtx =
    opts.tenant == null
      ? null
      : (() => {
          const t = ks.tenants.findOneBy("tenant_id", opts.tenant);
          return t
            ? { id: t.tenant_id, name: t.name, ...t.settings, ...t.properties }
            : { id: opts.tenant };
        })();

  const renderCtx: Record<string, unknown> = {
    ...opts.data,
    data: opts.data,
    recipient: recipientCtx,
    actor: actorCtx,
    tenant: tenantCtx,
  };

  const body = renderTemplate(opts.template.body, renderCtx);
  const subject = renderTemplate(opts.template.subject, renderCtx);
  const messageId = generateKsuid();
  const recipientStored: string | { id: string; collection: string } = isObjectRef(opts.recipient)
    ? { id: opts.recipient.id, collection: opts.recipient.collection }
    : typeof opts.recipient === "string"
      ? opts.recipient
      : opts.recipient.id;

  const msg = ks.messages.insert({
    message_id: messageId,
    channel_id: channel.channel_id,
    channel_type: channel.type,
    recipient: recipientStored,
    recipient_user_id: opts.user?.user_id ?? (typeof recipientStored === "string" ? recipientStored : null),
    workflow_key: opts.workflowKey,
    workflow_version_id: opts.versionId,
    tenant: opts.tenant,
    status: "delivered",
    engagement_statuses: [],
    seen_at: null,
    read_at: null,
    interacted_at: null,
    archived_at: null,
    clicked_at: null,
    link_clicked_at: null,
    data: opts.data,
    actors: opts.actor
      ? [typeof opts.actor === "string" ? opts.actor : isObjectRef(opts.actor) ? { id: opts.actor.id, collection: opts.actor.collection } : opts.actor.id]
      : [],
    content: {
      subject: subject || null,
      body: body || null,
      html_body: channel.type === "email" ? body || null : null,
      text_body: channel.type === "email" || channel.type === "sms" ? body || null : null,
      blocks:
        channel.type === "in_app_feed"
          ? [{ content: body, name: "body", rendered: body, type: "markdown" }]
          : undefined,
    },
    workflow_run_id: opts.runId,
    cancellation_key: opts.cancellationKey,
    interaction_metadata: null,
  });

  appendMessageEvent(ks, messageId, "message.delivered", { status: "delivered" });
  return msg;
}

function expandRecipients(
  ks: ReturnType<typeof getKnockStore>,
  recipients: RecipientRef[],
): Array<{ recipient: RecipientRef; user: KnockUser | null }> {
  const out: Array<{ recipient: RecipientRef; user: KnockUser | null }> = [];

  for (const raw of recipients) {
    if (typeof raw === "string") {
      const user = upsertUser(ks, raw);
      out.push({ recipient: raw, user });
      continue;
    }

    if (isObjectRef(raw)) {
      const subs = ks.subscriptions
        .all()
        .filter((s) => s.collection === raw.collection && s.object_id === raw.id);
      if (subs.length === 0) {
        out.push({ recipient: { id: raw.id, collection: raw.collection }, user: null });
        continue;
      }
      for (const sub of subs) {
        const user = upsertUser(ks, sub.recipient_id);
        out.push({ recipient: { id: raw.id, collection: raw.collection }, user });
      }
      continue;
    }

    if (isInlineUser(raw)) {
      const { id, ...rest } = raw;
      const user = upsertUser(ks, id, rest as Record<string, unknown>);
      out.push({ recipient: id, user });
      continue;
    }
  }

  return out;
}

export function workflowRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ks = () => getKnockStore(store);

  app.post("/v1/workflows/:key/trigger", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const key = c.req.param("key");
    const workflow = ks().workflows.findOneBy("key", key);
    if (!workflow) {
      return knockError(c, 404, "workflow_not_found", `Workflow \`${key}\` was not found`, "api_error");
    }

    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const recipients = body.recipients;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return knockError(c, 422, "invalid_params", "Missing required field: recipients", "invalid_request_error", [
        { field: "recipients", message: "must be a non-empty array" },
      ]);
    }

    const data = (body.data as Record<string, unknown> | undefined) ?? {};
    const cancellationKey = (body.cancellation_key as string | null | undefined) ?? null;
    let tenant: string | null = null;
    if (typeof body.tenant === "string") tenant = body.tenant;
    else if (body.tenant && typeof body.tenant === "object" && "id" in (body.tenant as object)) {
      const t = body.tenant as { id: string; [k: string]: unknown };
      const { id, ...rest } = t;
      const existing = ks().tenants.findOneBy("tenant_id", id);
      if (existing) {
        ks().tenants.update(existing.id, {
          name: (rest.name as string | undefined) ?? existing.name,
          properties: { ...existing.properties, ...rest },
        });
      } else {
        ks().tenants.insert({
          tenant_id: id,
          name: (rest.name as string | null | undefined) ?? null,
          settings: {},
          properties: rest,
        });
      }
      tenant = id;
    }

    let actor: RecipientRef | null = (body.actor as RecipientRef | null | undefined) ?? null;
    if (actor && isInlineUser(actor) && !isObjectRef(actor)) {
      const { id, ...rest } = actor;
      upsertUser(ks(), id, rest as Record<string, unknown>);
      actor = id;
    } else if (typeof actor === "string") {
      upsertUser(ks(), actor);
    }

    const runId = generateUuid();
    const expanded = expandRecipients(ks(), recipients as RecipientRef[]);
    const messageIds: string[] = [];

    for (const { recipient, user } of expanded) {
      for (const step of workflow.steps) {
        const msg = createMessageForRecipient({
          ks: ks(),
          workflowKey: workflow.key,
          versionId: workflow.version_id,
          runId,
          cancellationKey,
          tenant,
          data,
          actor,
          channelRef: step.channel,
          template: step.template ?? {},
          recipient,
          user,
        });
        if (msg) messageIds.push(msg.message_id);
      }
    }

    ks().workflowRuns.insert({
      workflow_run_id: runId,
      workflow_key: workflow.key,
      status: "completed",
      recipients: (recipients as RecipientRef[]).map((r) =>
        typeof r === "string" ? r : isObjectRef(r) ? { id: r.id, collection: r.collection } : r.id,
      ),
      actor:
        actor == null
          ? null
          : typeof actor === "string"
            ? actor
            : isObjectRef(actor)
              ? { id: actor.id, collection: actor.collection }
              : actor.id,
      tenant,
      data,
      cancellation_key: cancellationKey,
      message_ids: messageIds,
    });

    return c.json({ workflow_run_id: runId }, 200);
  });

  app.post("/v1/workflows/:key/cancel", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const key = c.req.param("key");
    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const cancellationKey = body.cancellation_key as string | undefined;
    if (!cancellationKey) {
      return knockError(c, 422, "invalid_params", "Missing required field: cancellation_key", "invalid_request_error", [
        { field: "cancellation_key", message: "is required" },
      ]);
    }

    const recipientFilter = Array.isArray(body.recipients)
      ? new Set((body.recipients as RecipientRef[]).map(recipientKey))
      : null;

    const runs = ks()
      .workflowRuns.all()
      .filter((r) => r.workflow_key === key && r.cancellation_key === cancellationKey && r.status !== "canceled");

    for (const run of runs) {
      if (recipientFilter) {
        const overlap = run.recipients.some((r) => recipientFilter.has(recipientKey(r as RecipientRef)));
        if (!overlap) continue;
      }

      ks().workflowRuns.update(run.id, { status: "canceled" });

      for (const mid of run.message_ids) {
        const msg = ks().messages.findOneBy("message_id", mid);
        if (!msg) continue;
        if (recipientFilter) {
          const rk =
            typeof msg.recipient === "string"
              ? msg.recipient
              : `${msg.recipient.collection}:${msg.recipient.id}`;
          const userMatch = msg.recipient_user_id && recipientFilter.has(msg.recipient_user_id);
          if (!recipientFilter.has(rk) && !userMatch) continue;
        }
        if (msg.engagement_statuses.includes("interacted") || msg.engagement_statuses.includes("read")) {
          continue;
        }
        if (msg.status === "not_sent") continue;
        ks().messages.update(msg.id, { status: "not_sent" });
        appendMessageEvent(ks(), msg.message_id, "message.not_sent", { reason: "canceled" });
      }
    }

    return c.body(null, 204);
  });
}
