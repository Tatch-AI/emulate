import type { RouteContext } from "@emulators/core";
import { getKnockStore } from "../store.js";
import { deepMerge, knockError, paginateByCursor, parseKnockBody, requireSecretAuth } from "../helpers.js";

function formatTenant(t: {
  tenant_id: string;
  name: string | null;
  settings: Record<string, unknown>;
  properties: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}): Record<string, unknown> {
  return {
    id: t.tenant_id,
    name: t.name,
    __typename: "Tenant",
    settings: t.settings,
    created_at: t.created_at,
    updated_at: t.updated_at,
    ...t.properties,
  };
}

export function tenantRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ks = () => getKnockStore(store);

  app.get("/v1/tenants", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const all = ks()
      .tenants.all()
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const pageSize = Number(c.req.query("page_size") ?? 50);
    const after = c.req.query("after") ?? null;
    const { page, page_info } = paginateByCursor(all, (t) => t.tenant_id, { page_size: pageSize, after });
    return c.json({ entries: page.map(formatTenant), page_info });
  });

  app.put("/v1/tenants/:id", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const tenantId = c.req.param("id");
    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    const reserved = new Set(["id", "name", "settings", "created_at", "updated_at", "__typename"]);
    const properties: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!reserved.has(k)) properties[k] = v;
    }
    const settings = (body.settings as Record<string, unknown> | undefined) ?? {};
    const name = (body.name as string | null | undefined) ?? null;

    const existing = ks().tenants.findOneBy("tenant_id", tenantId);
    if (existing) {
      const updated = ks().tenants.update(existing.id, {
        name: name ?? existing.name,
        settings: deepMerge(existing.settings, settings),
        properties: deepMerge(existing.properties, properties),
      })!;
      return c.json(formatTenant(updated));
    }

    const created = ks().tenants.insert({
      tenant_id: tenantId,
      name,
      settings,
      properties,
    });
    return c.json(formatTenant(created));
  });

  app.get("/v1/tenants/:id", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const tenant = ks().tenants.findOneBy("tenant_id", c.req.param("id"));
    if (!tenant) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");
    return c.json(formatTenant(tenant));
  });

  app.delete("/v1/tenants/:id", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const tenant = ks().tenants.findOneBy("tenant_id", c.req.param("id"));
    if (!tenant) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");
    ks().tenants.delete(tenant.id);
    return c.body(null, 204);
  });
}
