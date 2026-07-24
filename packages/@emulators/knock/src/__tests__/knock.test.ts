import { describe, it, expect, beforeEach } from "vitest";
import {
  Hono,
  Store,
  WebhookDispatcher,
  authMiddleware,
  createApiErrorHandler,
  createErrorHandler,
  type TokenMap,
  type AppEnv,
} from "@emulators/core";
import { knockPlugin, seedFromConfig, getKnockStore, type KnockSeedConfig } from "../index.js";

const base = "http://localhost:4000";
const SECRET = "sk_test_secret";
const PUBLIC = "pk_test_public";

const defaultSeed: KnockSeedConfig = {
  api_keys: [
    { key: SECRET, name: "secret", type: "secret" },
    { key: PUBLIC, name: "public", type: "public" },
  ],
  channels: [
    { id: "in-app", key: "in-app", type: "in_app_feed", name: "In-app Feed" },
    { id: "email", key: "email", type: "email", name: "Email" },
    { id: "sms", key: "sms", type: "sms", name: "SMS" },
  ],
  workflows: [
    {
      key: "welcome",
      name: "Welcome",
      steps: [
        { channel: "in-app", template: { body: "Hello {{ recipient.name }}, welcome to {{ app }}!" } },
        { channel: "email", template: { subject: "Welcome {{ recipient.name }}", body: "Hi {{ recipient.name }}, from {{ actor.name }}" } },
      ],
    },
    {
      key: "comment",
      name: "Comment",
      steps: [{ channel: "in-app", template: { body: "{{ actor.name }} commented: {{ text }}" } }],
    },
  ],
  users: [{ id: "user_1", name: "Ada Lovelace", email: "ada@example.com" }],
  tenants: [{ id: "acme", name: "Acme Inc" }],
};

function createTestApp(seed: KnockSeedConfig = defaultSeed) {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();

  const app = new Hono<AppEnv>();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  app.use("*", authMiddleware(tokenMap));
  knockPlugin.register(app, store, webhooks, base, tokenMap);
  seedFromConfig(store, base, seed);

  return { app, store, webhooks };
}

function authHeaders(key = SECRET): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function trigger(
  app: Hono<AppEnv>,
  key: string,
  body: Record<string, unknown>,
  headers = authHeaders(),
) {
  return app.request(`${base}/v1/workflows/${key}/trigger`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("Knock auth and errors", () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    app = createTestApp().app;
  });

  it("returns 401 authentication_error for missing bearer when keys are seeded", async () => {
    const res = await app.request(`${base}/v1/users/user_1`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string; type: string; status: number };
    expect(body.code).toBe("authentication_error");
    expect(body.type).toBe("authentication_error");
    expect(body.status).toBe(401);
  });

  it("returns 401 for wrong secret key", async () => {
    const res = await app.request(`${base}/v1/users/user_1`, { headers: authHeaders("sk_wrong") });
    expect(res.status).toBe(401);
  });

  it("returns 404 resource_missing shape", async () => {
    const res = await app.request(`${base}/v1/users/missing`, { headers: authHeaders() });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string; status: number };
    expect(body.code).toBe("resource_missing");
    expect(body.message).toBeTruthy();
    expect(body.status).toBe(404);
  });

  it("returns 422 invalid_params with field errors", async () => {
    const res = await trigger(app, "welcome", {});
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string; errors: Array<{ field: string }> };
    expect(body.code).toBe("invalid_params");
    expect(body.errors?.[0]?.field).toBe("recipients");
  });

  it("accepts any bearer when no keys are seeded", async () => {
    const { app: openApp } = createTestApp({
      channels: defaultSeed.channels,
      workflows: defaultSeed.workflows,
      users: defaultSeed.users,
    });
    const res = await openApp.request(`${base}/v1/users/user_1`, {
      headers: authHeaders("sk_anything"),
    });
    expect(res.status).toBe(200);
  });
});

describe("Knock workflows", () => {
  let app: Hono<AppEnv>;
  let store: Store;

  beforeEach(() => {
    ({ app, store } = createTestApp());
  });

  it("triggers multi-step workflow and renders templates", async () => {
    const res = await trigger(app, "welcome", {
      recipients: ["user_1"],
      actor: { id: "actor_1", name: "Grace Hopper" },
      data: { app: "Emulate" },
      tenant: "acme",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workflow_run_id: string };
    expect(body.workflow_run_id).toBeTruthy();

    const ks = getKnockStore(store);
    const msgs = ks.messages.all().filter((m) => m.workflow_run_id === body.workflow_run_id);
    expect(msgs).toHaveLength(2);

    const feed = msgs.find((m) => m.channel_type === "in_app_feed")!;
    expect(feed.status).toBe("delivered");
    expect(feed.content.body).toContain("Ada Lovelace");
    expect(feed.content.body).toContain("Emulate");
    expect(feed.tenant).toBe("acme");

    const email = msgs.find((m) => m.channel_type === "email")!;
    expect(email.content.subject).toBe("Welcome Ada Lovelace");
    expect(email.content.body).toContain("Grace Hopper");
    expect(email.status).toBe("delivered");
  });

  it("inline recipient identify upserts users", async () => {
    const res = await trigger(app, "comment", {
      recipients: [{ id: "user_new", name: "New User", email: "new@example.com", plan: "pro" }],
      actor: "user_1",
      data: { text: "hello" },
    });
    expect(res.status).toBe(200);

    const user = getKnockStore(store).users.findOneBy("user_id", "user_new")!;
    expect(user.name).toBe("New User");
    expect(user.email).toBe("new@example.com");
    expect(user.properties.plan).toBe("pro");
  });

  it("returns 404 for unknown workflow", async () => {
    const res = await trigger(app, "missing-wf", { recipients: ["user_1"] });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("workflow_not_found");
  });

  it("fans out object recipients via subscriptions", async () => {
    await app.request(`${base}/v1/objects/projects/proj_1`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Apollo" }),
    });
    await app.request(`${base}/v1/objects/projects/proj_1/subscriptions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ recipients: ["user_1", "user_2"] }),
    });

    const res = await trigger(app, "comment", {
      recipients: [{ id: "proj_1", collection: "projects" }],
      actor: "user_1",
      data: { text: "ship it" },
    });
    expect(res.status).toBe(200);

    const msgs = getKnockStore(store).messages.all().filter((m) => m.workflow_key === "comment");
    const recipients = new Set(msgs.map((m) => m.recipient_user_id));
    expect(recipients.has("user_1")).toBe(true);
    expect(recipients.has("user_2")).toBe(true);
  });

  it("cancels undelivered runs by cancellation_key", async () => {
    await trigger(app, "welcome", {
      recipients: ["user_1"],
      cancellation_key: "cancel-me",
      data: { app: "X" },
    });

    const cancel = await app.request(`${base}/v1/workflows/welcome/cancel`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ cancellation_key: "cancel-me" }),
    });
    expect(cancel.status).toBe(204);

    const ks = getKnockStore(store);
    const run = ks.workflowRuns.all().find((r) => r.cancellation_key === "cancel-me")!;
    expect(run.status).toBe("canceled");
    for (const mid of run.message_ids) {
      const msg = ks.messages.findOneBy("message_id", mid)!;
      expect(msg.status).toBe("not_sent");
    }
  });

  it("does not cancel messages already interacted with", async () => {
    await trigger(app, "welcome", {
      recipients: ["user_1"],
      cancellation_key: "keep-interacted",
      data: { app: "X" },
    });
    const msg = getKnockStore(store).messages.all().find((m) => m.cancellation_key === "keep-interacted")!;
    await app.request(`${base}/v1/messages/${msg.message_id}/interacted`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ metadata: { button: "ok" } }),
    });

    await app.request(`${base}/v1/workflows/welcome/cancel`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ cancellation_key: "keep-interacted" }),
    });

    const updated = getKnockStore(store).messages.findOneBy("message_id", msg.message_id)!;
    expect(updated.status).toBe("delivered");
    expect(updated.engagement_statuses).toContain("interacted");
  });
});

describe("Knock users", () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    app = createTestApp().app;
  });

  it("identifies, gets, lists with cursor pagination, merges, and deletes", async () => {
    const put = await app.request(`${base}/v1/users/u_page`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Page", email: "p@example.com", tier: "gold" }),
    });
    expect(put.status).toBe(200);
    const user = (await put.json()) as { id: string; name: string; tier: string; __typename: string };
    expect(user.id).toBe("u_page");
    expect(user.tier).toBe("gold");
    expect(user.__typename).toBe("User");

    const get = await app.request(`${base}/v1/users/u_page`, { headers: authHeaders() });
    expect(get.status).toBe(200);

    for (let i = 0; i < 5; i++) {
      await app.request(`${base}/v1/users/page_${i}`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ name: `P${i}` }),
      });
    }

    const page1 = await app.request(`${base}/v1/users?page_size=3`, { headers: authHeaders() });
    const p1 = (await page1.json()) as { entries: unknown[]; page_info: { after: string | null; page_size: number } };
    expect(p1.entries).toHaveLength(3);
    expect(p1.page_info.page_size).toBe(3);
    expect(p1.page_info.after).toBeTruthy();

    const page2 = await app.request(`${base}/v1/users?page_size=3&after=${p1.page_info.after}`, {
      headers: authHeaders(),
    });
    const p2 = (await page2.json()) as { entries: unknown[] };
    expect(p2.entries.length).toBeGreaterThan(0);

    await app.request(`${base}/v1/users/from_user`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ name: "From", email: "from@example.com" }),
    });
    const merge = await app.request(`${base}/v1/users/u_page/merge`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ from_user_id: "from_user" }),
    });
    expect(merge.status).toBe(200);

    const missing = await app.request(`${base}/v1/users/from_user`, { headers: authHeaders() });
    expect(missing.status).toBe(404);

    const del = await app.request(`${base}/v1/users/u_page`, { method: "DELETE", headers: authHeaders() });
    expect(del.status).toBe(204);
  });

  it("bulk identify returns completed BulkOperation", async () => {
    const res = await app.request(`${base}/v1/users/bulk/identify`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        users: [
          { id: "b1", name: "Bulk One" },
          { id: "b2", name: "Bulk Two" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string; status: string; success_count: number };
    expect(body.name).toBe("users.identify");
    expect(body.status).toBe("completed");
    expect(body.success_count).toBe(2);
  });

  it("deep-merges properties on identify", async () => {
    await app.request(`${base}/v1/users/merge_props`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ name: "A", meta: { a: 1, b: 2 } }),
    });
    const res = await app.request(`${base}/v1/users/merge_props`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ meta: { b: 3, c: 4 } }),
    });
    const body = (await res.json()) as { name: string; meta: { a: number; b: number; c: number } };
    expect(body.name).toBe("A");
    expect(body.meta).toEqual({ a: 1, b: 3, c: 4 });
  });
});

describe("Knock messages and engagement", () => {
  let app: Hono<AppEnv>;
  let messageId: string;

  beforeEach(async () => {
    app = createTestApp().app;
    await trigger(app, "welcome", { recipients: ["user_1"], data: { app: "Test" } });
    const list = await app.request(`${base}/v1/messages?workflow=welcome`, { headers: authHeaders() });
    const body = (await list.json()) as { items: Array<{ id: string; channel_id: string }> };
    messageId = body.items.find((m) => m.channel_id === "in-app")?.id ?? body.items[0].id;
  });

  it("lists and gets messages and content", async () => {
    const get = await app.request(`${base}/v1/messages/${messageId}`, { headers: authHeaders() });
    expect(get.status).toBe(200);
    const msg = (await get.json()) as { __typename: string; status: string };
    expect(msg.__typename).toBe("Message");
    expect(msg.status).toBe("delivered");

    const content = await app.request(`${base}/v1/messages/${messageId}/content`, { headers: authHeaders() });
    expect(content.status).toBe(200);
    const c = (await content.json()) as { blocks?: unknown[] };
    expect(c.blocks?.length).toBeGreaterThan(0);
  });

  it("transitions engagement statuses including reverse and batch", async () => {
    const seen = await app.request(`${base}/v1/messages/${messageId}/seen`, {
      method: "PUT",
      headers: authHeaders(),
    });
    expect(((await seen.json()) as { engagement_statuses: string[] }).engagement_statuses).toContain("seen");

    const read = await app.request(`${base}/v1/messages/${messageId}/read`, {
      method: "PUT",
      headers: authHeaders(),
    });
    expect(((await read.json()) as { engagement_statuses: string[]; read_at: string }).read_at).toBeTruthy();

    const interacted = await app.request(`${base}/v1/messages/${messageId}/interacted`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ metadata: { action: "click" } }),
    });
    expect(((await interacted.json()) as { engagement_statuses: string[] }).engagement_statuses).toContain(
      "interacted",
    );

    const archived = await app.request(`${base}/v1/messages/${messageId}/archived`, {
      method: "PUT",
      headers: authHeaders(),
    });
    expect(((await archived.json()) as { engagement_statuses: string[] }).engagement_statuses).toContain(
      "archived",
    );

    const unarchived = await app.request(`${base}/v1/messages/${messageId}/archived`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(((await unarchived.json()) as { engagement_statuses: string[] }).engagement_statuses).not.toContain(
      "archived",
    );

    const unread = await app.request(`${base}/v1/messages/${messageId}/read`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(((await unread.json()) as { engagement_statuses: string[]; read_at: string | null }).read_at).toBeNull();

    const unseen = await app.request(`${base}/v1/messages/${messageId}/seen`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(((await unseen.json()) as { engagement_statuses: string[] }).engagement_statuses).not.toContain("seen");

    const batch = await app.request(`${base}/v1/messages/batch/seen`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message_ids: [messageId] }),
    });
    expect(batch.status).toBe(200);
    const batchBody = (await batch.json()) as Array<{ engagement_statuses: string[] }>;
    expect(batchBody[0].engagement_statuses).toContain("seen");

    const events = await app.request(`${base}/v1/messages/${messageId}/events`, { headers: authHeaders() });
    const ev = (await events.json()) as { items: unknown[] };
    expect(ev.items.length).toBeGreaterThan(1);
  });

  it("supports channel bulk status updates", async () => {
    const res = await app.request(`${base}/v1/channels/in-app/messages/bulk/read`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ user_ids: ["user_1"] }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; name: string };
    expect(body.status).toBe("completed");
  });
});

describe("Knock feeds", () => {
  let app: Hono<AppEnv>;

  beforeEach(async () => {
    app = createTestApp().app;
    await trigger(app, "welcome", {
      recipients: ["user_1"],
      data: { app: "FeedApp" },
      tenant: "acme",
    });
    await trigger(app, "comment", {
      recipients: ["user_1"],
      actor: "user_1",
      data: { text: "hi" },
    });
  });

  it("returns feed with meta counts and filters", async () => {
    const all = await app.request(`${base}/v1/users/user_1/feeds/in-app`, {
      headers: authHeaders(PUBLIC),
    });
    expect(all.status).toBe(200);
    const body = (await all.json()) as {
      entries: unknown[];
      meta: { total_count: number; unread_count: number; unseen_count: number };
      page_info: { __typename: string };
    };
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    expect(body.meta.total_count).toBeGreaterThanOrEqual(2);
    expect(body.meta.unread_count).toBe(body.meta.total_count);
    expect(body.page_info.__typename).toBe("PageInfo");

    const firstId = (body.entries[0] as { id: string }).id;
    await app.request(`${base}/v1/messages/${firstId}/read`, { method: "PUT", headers: authHeaders() });

    const afterRead = await app.request(`${base}/v1/users/user_1/feeds/in-app`, {
      headers: authHeaders(PUBLIC),
    });
    const meta = ((await afterRead.json()) as { meta: { unread_count: number } }).meta;
    expect(meta.unread_count).toBe(body.meta.unread_count - 1);

    const unread = await app.request(`${base}/v1/users/user_1/feeds/in-app?status=unread`, {
      headers: authHeaders(PUBLIC),
    });
    const unreadBody = (await unread.json()) as { entries: Array<{ id: string }> };
    expect(unreadBody.entries.every((e) => e.id !== firstId)).toBe(true);

    const tenanted = await app.request(`${base}/v1/users/user_1/feeds/in-app?tenant=acme`, {
      headers: authHeaders(PUBLIC),
    });
    const tBody = (await tenanted.json()) as { entries: Array<{ tenant: string | null }> };
    expect(tBody.entries.every((e) => e.tenant === "acme")).toBe(true);

    await app.request(`${base}/v1/messages/${firstId}/archived`, { method: "PUT", headers: authHeaders() });
    const onlyArchived = await app.request(`${base}/v1/users/user_1/feeds/in-app?archived=only`, {
      headers: authHeaders(PUBLIC),
    });
    const arch = (await onlyArchived.json()) as { entries: Array<{ id: string }> };
    expect(arch.entries.some((e) => e.id === firstId)).toBe(true);

    const excluded = await app.request(`${base}/v1/users/user_1/feeds/in-app?archived=exclude`, {
      headers: authHeaders(PUBLIC),
    });
    const excl = (await excluded.json()) as { entries: Array<{ id: string }> };
    expect(excl.entries.every((e) => e.id !== firstId)).toBe(true);
  });

  it("allows feed access with no auth (documented relaxation)", async () => {
    const res = await app.request(`${base}/v1/users/user_1/feeds/in-app`);
    expect(res.status).toBe(200);
  });

  it("marks feed seen via feed status route", async () => {
    const res = await app.request(`${base}/v1/users/user_1/feeds/in-app/seen`, {
      method: "POST",
      headers: authHeaders(PUBLIC),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
  });
});

describe("Knock preferences enforcement", () => {
  let app: Hono<AppEnv>;
  let store: Store;

  beforeEach(() => {
    ({ app, store } = createTestApp());
  });

  it("skips email when channel_types.email is false but keeps feed", async () => {
    await app.request(`${base}/v1/users/user_1/preferences/default`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ channel_types: { email: false, in_app_feed: true } }),
    });

    await trigger(app, "welcome", { recipients: ["user_1"], data: { app: "Prefs" } });
    const msgs = getKnockStore(store).messages.all().filter((m) => m.workflow_key === "welcome");
    expect(msgs.some((m) => m.channel_type === "in_app_feed")).toBe(true);
    expect(msgs.some((m) => m.channel_type === "email")).toBe(false);
  });

  it("skips all steps when workflow preference is false", async () => {
    await app.request(`${base}/v1/users/user_1/preferences/default`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ workflows: { welcome: false } }),
    });

    await trigger(app, "welcome", { recipients: ["user_1"], data: { app: "Off" } });
    const msgs = getKnockStore(store).messages.all().filter((m) => m.workflow_key === "welcome");
    expect(msgs).toHaveLength(0);
  });
});

describe("Knock tenants and objects", () => {
  let app: Hono<AppEnv>;

  beforeEach(() => {
    app = createTestApp().app;
  });

  it("supports tenant CRUD and list pagination", async () => {
    const put = await app.request(`${base}/v1/tenants/t1`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ name: "T1", settings: { branding: { primary_color: "#000" } } }),
    });
    expect(put.status).toBe(200);

    const get = await app.request(`${base}/v1/tenants/t1`, { headers: authHeaders() });
    expect(((await get.json()) as { name: string }).name).toBe("T1");

    const list = await app.request(`${base}/v1/tenants`, { headers: authHeaders() });
    expect(((await list.json()) as { entries: unknown[] }).entries.length).toBeGreaterThan(0);

    const del = await app.request(`${base}/v1/tenants/t1`, { method: "DELETE", headers: authHeaders() });
    expect(del.status).toBe(204);
  });

  it("supports object CRUD, subscriptions, and unsubscribe", async () => {
    const put = await app.request(`${base}/v1/objects/teams/team_1`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ name: "Team One" }),
    });
    expect(put.status).toBe(200);

    const sub = await app.request(`${base}/v1/objects/teams/team_1/subscriptions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ recipients: ["user_1"] }),
    });
    expect(sub.status).toBe(200);

    const list = await app.request(`${base}/v1/objects/teams/team_1/subscriptions`, {
      headers: authHeaders(),
    });
    expect(((await list.json()) as { entries: unknown[] }).entries).toHaveLength(1);

    const unsub = await app.request(`${base}/v1/objects/teams/team_1/subscriptions`, {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ recipients: ["user_1"] }),
    });
    expect(unsub.status).toBe(200);

    const list2 = await app.request(`${base}/v1/objects/teams/team_1/subscriptions`, {
      headers: authHeaders(),
    });
    expect(((await list2.json()) as { entries: unknown[] }).entries).toHaveLength(0);

    const del = await app.request(`${base}/v1/objects/teams/team_1`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(del.status).toBe(204);
  });
});

describe("Knock inspector and seed", () => {
  it("renders inspector page", async () => {
    const { app } = createTestApp();
    const res = await app.request(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Knock Inspector");
    expect(html).toContain("Messages");
  });

  it("seedFromConfig is idempotent", () => {
    const store = new Store();
    seedFromConfig(store, base, defaultSeed);
    seedFromConfig(store, base, defaultSeed);
    const ks = getKnockStore(store);
    expect(ks.apiKeys.count()).toBe(2);
    expect(ks.channels.count()).toBe(3);
    expect(ks.workflows.count()).toBe(2);
    expect(ks.users.count()).toBe(1);
  });
});
