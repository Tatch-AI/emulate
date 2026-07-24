import type { RouteContext } from "@emulators/core";
import { getKnockStore } from "../store.js";
import {
  formatBulkOperation,
  formatMessage,
  formatUser,
  generateKsuid,
  knockError,
  nowIso,
  paginateByCursor,
  parseKnockBody,
  requireSecretAuth,
  upsertUser,
} from "../helpers.js";

export function userRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ks = () => getKnockStore(store);

  app.post("/v1/users/bulk/identify", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const users = body.users;
    if (!Array.isArray(users)) {
      return knockError(c, 422, "invalid_params", "Missing required field: users", "invalid_request_error", [
        { field: "users", message: "must be an array" },
      ]);
    }

    let success = 0;
    for (const raw of users) {
      if (!raw || typeof raw !== "object") continue;
      const u = raw as Record<string, unknown>;
      const id = u.id as string | undefined;
      if (!id) continue;
      upsertUser(ks(), id, u);
      success++;
    }

    const started = nowIso();
    const op = ks().bulkOperations.insert({
      bulk_id: generateKsuid(),
      name: "users.identify",
      status: "completed",
      estimated_total_rows: users.length,
      processed_rows: success,
      success_count: success,
      error_count: users.length - success,
      completed_at: started,
      started_at: started,
    });

    return c.json(formatBulkOperation(op), 200);
  });

  app.get("/v1/users", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const all = ks()
      .users.all()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const pageSize = Number(c.req.query("page_size") ?? 50);
    const after = c.req.query("after") ?? null;
    const { page, page_info } = paginateByCursor(all, (u) => u.user_id, { page_size: pageSize, after });
    return c.json({ entries: page.map(formatUser), page_info });
  });

  app.put("/v1/users/:user_id", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const userId = c.req.param("user_id");
    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const user = upsertUser(ks(), userId, body);
    return c.json(formatUser(user), 200);
  });

  app.get("/v1/users/:user_id", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const user = ks().users.findOneBy("user_id", c.req.param("user_id"));
    if (!user) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");
    return c.json(formatUser(user));
  });

  app.delete("/v1/users/:user_id", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const user = ks().users.findOneBy("user_id", c.req.param("user_id"));
    if (!user) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");

    for (const pref of ks().preferences.all().filter((p) => p.user_id === user.user_id)) {
      ks().preferences.delete(pref.id);
    }
    ks().users.delete(user.id);
    return c.body(null, 204);
  });

  app.post("/v1/users/:user_id/merge", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const userId = c.req.param("user_id");
    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const fromId = body.from_user_id as string | undefined;
    if (!fromId) {
      return knockError(c, 422, "invalid_params", "Missing required field: from_user_id", "invalid_request_error", [
        { field: "from_user_id", message: "is required" },
      ]);
    }

    const from = ks().users.findOneBy("user_id", fromId);
    if (!from) return knockError(c, 404, "resource_missing", `User \`${fromId}\` was not found`, "api_error");

    const target = upsertUser(ks(), userId, {
      name: from.name ?? undefined,
      email: from.email ?? undefined,
      phone_number: from.phone_number ?? undefined,
      avatar: from.avatar ?? undefined,
      ...from.properties,
    });

    for (const msg of ks().messages.all().filter((m) => m.recipient_user_id === fromId || m.recipient === fromId)) {
      ks().messages.update(msg.id, {
        recipient_user_id: userId,
        recipient: typeof msg.recipient === "string" ? userId : msg.recipient,
      });
    }

    for (const pref of ks().preferences.all().filter((p) => p.user_id === fromId)) {
      const existing = ks().preferences.all().find((p) => p.user_id === userId && p.preference_id === pref.preference_id);
      if (!existing) {
        ks().preferences.insert({
          user_id: userId,
          preference_id: pref.preference_id,
          categories: pref.categories,
          channel_types: pref.channel_types,
          workflows: pref.workflows,
        });
      }
      ks().preferences.delete(pref.id);
    }

    for (const sub of ks().subscriptions.all().filter((s) => s.recipient_id === fromId)) {
      ks().subscriptions.update(sub.id, { recipient_id: userId });
    }

    ks().users.delete(from.id);
    return c.json(formatUser(target));
  });

  app.get("/v1/users/:user_id/messages", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const userId = c.req.param("user_id");
    let msgs = ks()
      .messages.all()
      .filter((m) => m.recipient_user_id === userId || m.recipient === userId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const workflow = c.req.query("workflow");
    if (workflow) msgs = msgs.filter((m) => m.workflow_key === workflow);
    const tenant = c.req.query("tenant");
    if (tenant) msgs = msgs.filter((m) => m.tenant === tenant);

    const pageSize = Number(c.req.query("page_size") ?? 50);
    const after = c.req.query("after") ?? null;
    const { page, page_info } = paginateByCursor(msgs, (m) => m.message_id, { page_size: pageSize, after });
    return c.json({ items: page.map(formatMessage), page_info });
  });
}
