import type { RouteContext } from "@emulators/core";
import { getKnockStore } from "../store.js";
import {
  applyEngagement,
  appendMessageEvent,
  knockError,
  paginateByCursor,
  parseKnockBody,
  requireFeedAuth,
  resolveChannel,
  type EngagementAction,
} from "../helpers.js";
import type { KnockMessage } from "../entities.js";

function toFeedItem(msg: KnockMessage, ks: ReturnType<typeof getKnockStore>): Record<string, unknown> {
  const actorRefs = msg.actors;
  const actors = actorRefs.map((a) => {
    if (typeof a === "string") {
      const u = ks.users.findOneBy("user_id", a);
      return u
        ? { id: u.user_id, name: u.name, email: u.email, __typename: "User", ...u.properties }
        : { id: a, __typename: "User" };
    }
    return { ...a, __typename: "Object" };
  });

  const recipient =
    msg.recipient_user_id != null
      ? (() => {
          const u = ks.users.findOneBy("user_id", msg.recipient_user_id!);
          return u
            ? { id: u.user_id, name: u.name, email: u.email, __typename: "User", ...u.properties }
            : { id: msg.recipient_user_id, __typename: "User" };
        })()
      : msg.recipient;

  return {
    id: msg.message_id,
    __typename: "FeedItem",
    activities: [
      {
        id: msg.message_id,
        __typename: "Activity",
        actor: actors[0] ?? null,
        recipient,
        data: msg.data,
        inserted_at: msg.created_at,
      },
    ],
    actors,
    blocks: msg.content.blocks ?? [
      {
        content: msg.content.body ?? "",
        name: "body",
        rendered: msg.content.body ?? "",
        type: "markdown",
      },
    ],
    data: msg.data,
    inserted_at: msg.created_at,
    read_at: msg.read_at,
    seen_at: msg.seen_at,
    interacted_at: msg.interacted_at,
    archived_at: msg.archived_at,
    clicked_at: msg.clicked_at,
    link_clicked_at: msg.link_clicked_at,
    source: {
      __typename: "WorkflowSource",
      key: msg.workflow_key,
      version_id: msg.workflow_version_id,
      categories: [],
    },
    tenant: msg.tenant,
    total_activities: 1,
    total_actors: Math.max(actors.length, 1),
  };
}

function resolveChannelId(ks: ReturnType<typeof getKnockStore>, channelRef: string): string | null {
  const ch = resolveChannel(ks, channelRef);
  return ch?.channel_id ?? null;
}

function filterFeedMessages(
  msgs: KnockMessage[],
  query: {
    status?: string;
    archived?: string;
    tenant?: string | null;
    has_tenant?: string | null;
    source?: string | null;
  },
): KnockMessage[] {
  let out = msgs;

  const status = query.status ?? "all";
  if (status === "unread") out = out.filter((m) => !m.engagement_statuses.includes("read"));
  else if (status === "unseen") out = out.filter((m) => !m.engagement_statuses.includes("seen"));
  else if (status === "read") out = out.filter((m) => m.engagement_statuses.includes("read"));
  else if (status === "seen") out = out.filter((m) => m.engagement_statuses.includes("seen"));

  const archived = query.archived ?? "exclude";
  if (archived === "exclude") out = out.filter((m) => !m.engagement_statuses.includes("archived"));
  else if (archived === "only") out = out.filter((m) => m.engagement_statuses.includes("archived"));

  if (query.tenant) out = out.filter((m) => m.tenant === query.tenant);
  if (query.has_tenant === "true") out = out.filter((m) => m.tenant != null);
  if (query.has_tenant === "false") out = out.filter((m) => m.tenant == null);
  if (query.source) out = out.filter((m) => m.workflow_key === query.source);

  return out;
}

function feedMeta(allForUserChannel: KnockMessage[]): Record<string, unknown> {
  const nonArchived = allForUserChannel.filter((m) => !m.engagement_statuses.includes("archived"));
  return {
    __typename: "FeedMetadata",
    total_count: nonArchived.length,
    unread_count: nonArchived.filter((m) => !m.engagement_statuses.includes("read")).length,
    unseen_count: nonArchived.filter((m) => !m.engagement_statuses.includes("seen")).length,
  };
}

export function feedRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ks = () => getKnockStore(store);

  app.get("/v1/users/:user_id/feeds/:channel_id", (c) => {
    const auth = requireFeedAuth(c, ks());
    if (auth !== true) return auth;

    const userId = c.req.param("user_id");
    const channelRef = c.req.param("channel_id");
    const channelId = resolveChannelId(ks(), channelRef) ?? channelRef;

    const all = ks()
      .messages.all()
      .filter(
        (m) =>
          m.channel_type === "in_app_feed" &&
          (m.channel_id === channelId || m.channel_id === channelRef) &&
          (m.recipient_user_id === userId || m.recipient === userId) &&
          m.status !== "not_sent",
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const filtered = filterFeedMessages(all, {
      status: c.req.query("status"),
      archived: c.req.query("archived"),
      tenant: c.req.query("tenant"),
      has_tenant: c.req.query("has_tenant"),
      source: c.req.query("source"),
    });

    const pageSize = Number(c.req.query("page_size") ?? 50);
    const after = c.req.query("after") ?? null;
    const before = c.req.query("before") ?? null;
    const { page, page_info } = paginateByCursor(filtered, (m) => m.message_id, {
      page_size: pageSize,
      after,
      before,
    });

    return c.json({
      entries: page.map((m) => toFeedItem(m, ks())),
      page_info,
      vars: {},
      meta: feedMeta(all),
    });
  });

  app.post("/v1/users/:user_id/feeds/:channel_id/:status", async (c) => {
    const auth = requireFeedAuth(c, ks());
    if (auth !== true) return auth;

    const status = c.req.param("status");
    const actionMap: Record<string, EngagementAction> = {
      seen: "seen",
      unseen: "unseen",
      read: "read",
      unread: "unread",
      archived: "archived",
      unarchived: "unarchived",
    };
    const action = actionMap[status];
    if (!action) {
      return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");
    }

    const userId = c.req.param("user_id");
    const channelRef = c.req.param("channel_id");
    const channelId = resolveChannelId(ks(), channelRef) ?? channelRef;

    let bodyObj: Record<string, unknown> = {};
    try {
      const parsed = await parseKnockBody(c);
      if (!(parsed instanceof Response)) bodyObj = parsed;
    } catch {
      bodyObj = {};
    }

    let msgs = ks()
      .messages.all()
      .filter(
        (m) =>
          m.channel_type === "in_app_feed" &&
          (m.channel_id === channelId || m.channel_id === channelRef) &&
          (m.recipient_user_id === userId || m.recipient === userId),
      );

    const messageIds = bodyObj.message_ids as string[] | undefined;
    if (Array.isArray(messageIds)) {
      const set = new Set(messageIds);
      msgs = msgs.filter((m) => set.has(m.message_id));
    }

    for (const msg of msgs) {
      const patch = applyEngagement(msg, action);
      ks().messages.update(msg.id, patch);
      appendMessageEvent(ks(), msg.message_id, `message.${action}`, {});
    }

    return c.json({ status: "ok", count: msgs.length });
  });

  app.get("/v1/users/:user_id/feeds/:channel_id/settings", (c) => {
    const auth = requireFeedAuth(c, ks());
    if (auth !== true) return auth;
    return c.json({ features: { branding_required: false } });
  });
}
