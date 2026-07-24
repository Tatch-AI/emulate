import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  Hono,
  Store,
  WebhookDispatcher,
  createApiErrorHandler,
  createErrorHandler,
  serve,
  type AppEnv,
  type TokenMap,
} from "@emulators/core";
import { deepgramPlugin, seedFromConfig, getDeepgramStore, type DeepgramSeedConfig } from "../index.js";

export const deepgramTestBaseUrl = "http://localhost:4000";
export const deepgramTestKey = "deepgram_test_key";

export interface DeepgramTestApp {
  app: Hono<AppEnv>;
  store: Store;
  webhooks: WebhookDispatcher;
  tokenMap: TokenMap;
}

export interface DeepgramTestEmulator extends DeepgramTestApp {
  url: string;
  close: () => Promise<void>;
}

export function createDeepgramTestApp(
  seed: DeepgramSeedConfig = {
    projects: [{ name: "Default" }],
    api_keys: [deepgramTestKey],
  },
  baseUrl = deepgramTestBaseUrl,
): DeepgramTestApp {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();

  const app = new Hono<AppEnv>();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  deepgramPlugin.register(app, store, webhooks, baseUrl, tokenMap);
  seedFromConfig(store, baseUrl, seed);

  return { app, store, webhooks, tokenMap };
}

export function tokenHeaders(key = deepgramTestKey, contentType = "application/json"): Record<string, string> {
  return { Authorization: `Token ${key}`, "Content-Type": contentType };
}

export function bearerHeaders(token: string, contentType = "application/json"): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": contentType };
}

export async function startDeepgramTestEmulator(
  seed: DeepgramSeedConfig = {
    projects: [{ name: "Default" }],
    api_keys: [deepgramTestKey],
  },
): Promise<DeepgramTestEmulator> {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();

  const app = new Hono<AppEnv>();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());

  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as unknown as Server;
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  deepgramPlugin.register(app, store, webhooks, url, tokenMap);
  seedFromConfig(store, url, seed);

  return {
    app,
    store,
    webhooks,
    tokenMap,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export { getDeepgramStore };
