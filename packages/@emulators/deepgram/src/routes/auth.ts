import type { RouteContext } from "@emulators/core";
import { getDeepgramStore } from "../store.js";
import { deepgramError, generateOpaqueToken, requireDeepgramAuth } from "../helpers.js";

export function authRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ds = () => getDeepgramStore(store);

  app.post("/v1/auth/grant", async (c) => {
    const auth = requireDeepgramAuth(c, ds(), { apiKeyOnly: true });
    if (auth instanceof Response) return auth;

    let ttl = 30;
    try {
      const text = await c.req.text();
      if (text) {
        const body = JSON.parse(text) as Record<string, unknown>;
        if (body.ttl_seconds != null) {
          const n = Number(body.ttl_seconds);
          if (!Number.isFinite(n) || n < 1 || n > 3600) {
            return deepgramError(c, 400, "Bad Request", "ttl_seconds must be between 1 and 3600.");
          }
          ttl = Math.floor(n);
        }
      }
    } catch {
      return deepgramError(c, 400, "Bad Request", "Invalid JSON body.");
    }

    const access_token = generateOpaqueToken("dg_temp");
    const expires_at = Date.now() + ttl * 1000;
    ds().tempTokens.insert({
      access_token,
      expires_at,
      expires_in: ttl,
      api_key_id: auth.apiKey?.api_key_id ?? null,
    });

    return c.json({ access_token, expires_in: ttl }, 200);
  });
}
