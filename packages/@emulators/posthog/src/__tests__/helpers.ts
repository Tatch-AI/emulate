import {
  Hono,
  Store,
  WebhookDispatcher,
  authMiddleware,
  createApiErrorHandler,
  createErrorHandler,
  serve,
  type AppEnv,
  type TokenMap,
} from "@emulators/core";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  DEFAULT_PERSONAL_API_KEY,
  DEFAULT_PROJECT_API_KEY,
  getPostHogStore,
  posthogPlugin,
  seedFromConfig,
  type PostHogSeedConfig,
} from "../index.js";

export const base = "http://localhost:4000";

export interface PostHogTestApp {
  app: Hono<AppEnv>;
  store: Store;
  webhooks: WebhookDispatcher;
  tokenMap: TokenMap;
}

export interface PostHogTestEmulator extends PostHogTestApp {
  url: string;
  close: () => Promise<void>;
}

export function createPostHogTestApp(seed?: PostHogSeedConfig): PostHogTestApp {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  tokenMap.set(DEFAULT_PERSONAL_API_KEY, {
    login: "posthog-admin",
    id: 1,
    scopes: [],
  });

  const app = new Hono<AppEnv>();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  app.use("*", authMiddleware(tokenMap));
  posthogPlugin.register(app, store, webhooks, base, tokenMap);
  if (seed) seedFromConfig(store, base, seed);
  else posthogPlugin.seed?.(store, base);

  return { app, store, webhooks, tokenMap };
}

export async function startPostHogTestEmulator(
  seed?: PostHogSeedConfig,
  customize?: (setup: PostHogTestApp) => void | Promise<void>,
): Promise<PostHogTestEmulator> {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  tokenMap.set(DEFAULT_PERSONAL_API_KEY, {
    login: "posthog-admin",
    id: 1,
    scopes: [],
  });

  const app = new Hono<AppEnv>();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  app.use("*", authMiddleware(tokenMap));

  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as unknown as Server;
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  posthogPlugin.register(app, store, webhooks, url, tokenMap);
  if (seed) seedFromConfig(store, url, seed);
  else posthogPlugin.seed?.(store, url);

  const setup = { app, store, webhooks, tokenMap };
  await customize?.(setup);

  return {
    ...setup,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function personalAuthHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${DEFAULT_PERSONAL_API_KEY}`,
    "Content-Type": "application/json",
  };
}

export function jsonHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export { DEFAULT_PERSONAL_API_KEY, DEFAULT_PROJECT_API_KEY, getPostHogStore };
