import type { RouteContext } from "@emulators/core";
import { getKnockStore } from "../store.js";
import { formatPreferenceSet, knockError, parseKnockBody, requireSecretAuth } from "../helpers.js";

export function preferenceRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ks = () => getKnockStore(store);

  app.get("/v1/users/:user_id/preferences", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const userId = c.req.param("user_id");
    const user = ks().users.findOneBy("user_id", userId);
    if (!user) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");

    let prefs = ks()
      .preferences.all()
      .filter((p) => p.user_id === userId);

    if (prefs.length === 0) {
      const created = ks().preferences.insert({
        user_id: userId,
        preference_id: "default",
        categories: {},
        channel_types: {},
        workflows: {},
      });
      prefs = [created];
    }

    return c.json(prefs.map(formatPreferenceSet));
  });

  app.get("/v1/users/:user_id/preferences/:id", (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const userId = c.req.param("user_id");
    const prefId = c.req.param("id");
    const user = ks().users.findOneBy("user_id", userId);
    if (!user) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");

    let pref = ks()
      .preferences.all()
      .find((p) => p.user_id === userId && p.preference_id === prefId);

    if (!pref && prefId === "default") {
      pref = ks().preferences.insert({
        user_id: userId,
        preference_id: "default",
        categories: {},
        channel_types: {},
        workflows: {},
      });
    }

    if (!pref) return knockError(c, 404, "resource_missing", "The resource you requested does not exist", "api_error");
    return c.json(formatPreferenceSet(pref));
  });

  app.put("/v1/users/:user_id/preferences/:id", async (c) => {
    const auth = requireSecretAuth(c, ks());
    if (auth !== true) return auth;

    const userId = c.req.param("user_id");
    const prefId = c.req.param("id");
    const body = await parseKnockBody(c);
    if (body instanceof Response) return body;

    if (!ks().users.findOneBy("user_id", userId)) {
      // Identify empty user so preference sets can be set before identify
      ks().users.insert({
        user_id: userId,
        name: null,
        email: null,
        phone_number: null,
        avatar: null,
        properties: {},
      });
    }

    const existing = ks()
      .preferences.all()
      .find((p) => p.user_id === userId && p.preference_id === prefId);

    const categories = (body.categories as Record<string, unknown> | undefined) ?? {};
    const channel_types = (body.channel_types as Record<string, unknown> | undefined) ?? {};
    const workflows = (body.workflows as Record<string, unknown> | undefined) ?? {};

    if (existing) {
      const updated = ks().preferences.update(existing.id, { categories, channel_types, workflows })!;
      return c.json(formatPreferenceSet(updated));
    }

    const created = ks().preferences.insert({
      user_id: userId,
      preference_id: prefId,
      categories,
      channel_types,
      workflows,
    });
    return c.json(formatPreferenceSet(created));
  });
}
