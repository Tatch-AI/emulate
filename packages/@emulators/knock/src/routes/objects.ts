import type { RouteContext } from "@emulators/core";
import { getKnockStore } from "../store.js";
import {
  generateKsuid,
  knockError,
  paginateByCursor,
  parseKnockBody,
  requireSecretAuth,
  deepMerge,
} from "../helpers.js";

function formatObject(obj: {
  object_id: string;
  collection: string;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}): Record<string, unknown> {
  return {
    id: obj.object_id,
    collection: obj.collection,
    __typename: "Object",
    created_at: obj.created_at,
    updated_at: obj.updated_at,
    ...obj.properties,
  };
}

export function objectRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ks = () => getKnockStore(store);

  app.get("/v1/objects/:collection", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const collection = c.req.param("collection");
    const all = ks()
      .objects.all()
      .filter((o) => o.collection === collection)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const pageSize = Number(c.req.query("page_size") ?? 50);
    const after = c.req.query("after") ?? null;
    const { page, page_info } = paginateByCursor(all, (o) => o.object_id, { page_size: pageSize, after });
    return c.json({ entries: page.map(formatObject), page_info });
  });

  app.put("/v1/objects/:collection/:object_id", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const collection = c.req.param("collection");
    const objectId = c.req.param("object_id");
    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const reserved = new Set(["id", "collection", "created_at", "updated_at", "__typename"]);
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!reserved.has(k)) properties[k] = v;
    }

    const existing = ks()
      .objects.all()
      .find((o) => o.collection === collection && o.object_id === objectId);

    if (existing) {
      const updated = ks().objects.update(existing.id, {
        properties: deepMerge(existing.properties, properties),
      })!;
      return c.json(formatObject(updated));
    }

    const created = ks().objects.insert({
      collection,
      object_id: objectId,
      properties,
    });
    return c.json(formatObject(created));
  });

  app.get("/v1/objects/:collection/:object_id", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const collection = c.req.param("collection");
    const objectId = c.req.param("object_id");
    const obj = ks()
      .objects.all()
      .find((o) => o.collection === collection && o.object_id === objectId);
    if (!obj) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");
    return c.json(formatObject(obj));
  });

  app.delete("/v1/objects/:collection/:object_id", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const collection = c.req.param("collection");
    const objectId = c.req.param("object_id");
    const obj = ks()
      .objects.all()
      .find((o) => o.collection === collection && o.object_id === objectId);
    if (!obj) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");

    for (const sub of ks()
      .subscriptions.all()
      .filter((s) => s.collection === collection && s.object_id === objectId)) {
      ks().subscriptions.delete(sub.id);
    }
    ks().objects.delete(obj.id);
    return c.body(null, 204);
  });

  app.post("/v1/objects/:collection/:object_id/subscriptions", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const collection = c.req.param("collection");
    const objectId = c.req.param("object_id");
    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const recipients = body.recipients;
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return knockError(c, 422, "invalid_params", "Missing required field: recipients", "invalid_request_error", [
        { field: "recipients", message: "must be a non-empty array" },
      ]);
    }

    let obj = ks()
      .objects.all()
      .find((o) => o.collection === collection && o.object_id === objectId);
    if (!obj) {
      obj = ks().objects.insert({ collection, object_id: objectId, properties: {} });
    }

    const properties = (body.properties as Record<string, unknown> | undefined) ?? {};
    const created = [];
    for (const raw of recipients) {
      const recipientId = typeof raw === "string" ? raw : (raw as { id: string }).id;
      if (!recipientId) continue;
      const existing = ks()
        .subscriptions.all()
        .find((s) => s.collection === collection && s.object_id === objectId && s.recipient_id === recipientId);
      if (existing) {
        created.push(existing);
        continue;
      }
      created.push(
        ks().subscriptions.insert({
          subscription_id: generateKsuid(),
          collection,
          object_id: objectId,
          recipient_id: recipientId,
          properties,
        }),
      );
    }

    return c.json(
      created.map((s) => ({
        __typename: "Subscription",
        id: s.subscription_id,
        properties: s.properties,
        recipient: { id: s.recipient_id, __typename: "User" },
        object: formatObject(obj!),
        inserted_at: s.created_at,
        updated_at: s.updated_at,
      })),
    );
  });

  app.get("/v1/objects/:collection/:object_id/subscriptions", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const collection = c.req.param("collection");
    const objectId = c.req.param("object_id");
    const all = ks()
      .subscriptions.all()
      .filter((s) => s.collection === collection && s.object_id === objectId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));

    const obj = ks()
      .objects.all()
      .find((o) => o.collection === collection && o.object_id === objectId);

    const pageSize = Number(c.req.query("page_size") ?? 50);
    const after = c.req.query("after") ?? null;
    const { page, page_info } = paginateByCursor(all, (s) => s.subscription_id, { page_size: pageSize, after });

    return c.json({
      entries: page.map((s) => ({
        __typename: "Subscription",
        id: s.subscription_id,
        properties: s.properties,
        recipient: { id: s.recipient_id, __typename: "User" },
        object: obj ? formatObject(obj) : { id: objectId, collection },
        inserted_at: s.created_at,
        updated_at: s.updated_at,
      })),
      page_info,
    });
  });

  app.delete("/v1/objects/:collection/:object_id/subscriptions", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const collection = c.req.param("collection");
    const objectId = c.req.param("object_id");
    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const recipients = body.recipients;
    if (!Array.isArray(recipients)) {
      return knockError(c, 422, "invalid_params", "Missing required field: recipients", "invalid_request_error", [
        { field: "recipients", message: "must be an array" },
      ]);
    }

    const ids = new Set(
      recipients.map((r) => (typeof r === "string" ? r : (r as { id: string }).id)).filter(Boolean),
    );
    const removed = [];
    for (const sub of ks()
      .subscriptions.all()
      .filter((s) => s.collection === collection && s.object_id === objectId && ids.has(s.recipient_id))) {
      removed.push(sub);
      ks().subscriptions.delete(sub.id);
    }

    return c.json(
      removed.map((s) => ({
        __typename: "Subscription",
        id: s.subscription_id,
        recipient: { id: s.recipient_id, __typename: "User" },
      })),
    );
  });
}
