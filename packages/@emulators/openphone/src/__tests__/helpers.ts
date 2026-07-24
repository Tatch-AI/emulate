import { Hono, Store, WebhookDispatcher, type AppEnv } from "@emulators/core";
import { openphonePlugin, DEFAULT_API_KEY } from "../index.js";

export const openPhoneTestBaseUrl = "http://localhost:4310";

export interface OpenPhoneTestApp {
  app: Hono<AppEnv>;
  store: Store;
  webhooks: WebhookDispatcher;
}

export function createOpenPhoneTestApp(): OpenPhoneTestApp {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const app = new Hono<AppEnv>();
  openphonePlugin.register(app, store, webhooks, openPhoneTestBaseUrl);
  openphonePlugin.seed?.(store, openPhoneTestBaseUrl);
  return { app, store, webhooks };
}

export function authHeaders(key = DEFAULT_API_KEY, bearer = false): Record<string, string> {
  return {
    Authorization: bearer ? `Bearer ${key}` : key,
    "Content-Type": "application/json",
  };
}

export function jsonBody(data: unknown): string {
  return JSON.stringify(data);
}
