import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
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
import { knockPlugin, seedFromConfig, type KnockSeedConfig } from "../index.js";

export const knockTestSecret = "sk_test_sdk";
export const knockTestPublic = "pk_test_sdk";

export interface KnockTestApp {
  app: Hono<AppEnv>;
  store: Store;
  webhooks: WebhookDispatcher;
  tokenMap: TokenMap;
}

export interface KnockTestEmulator extends KnockTestApp {
  url: string;
  close: () => Promise<void>;
}

export const defaultSdkSeed: KnockSeedConfig = {
  api_keys: [
    { key: knockTestSecret, name: "secret", type: "secret" },
    { key: knockTestPublic, name: "public", type: "public" },
  ],
  channels: [
    { id: "in-app", key: "in-app", type: "in_app_feed", name: "In-app" },
    { id: "email", key: "email", type: "email", name: "Email" },
  ],
  workflows: [
    {
      key: "sdk-welcome",
      name: "SDK Welcome",
      steps: [
        { channel: "in-app", template: { body: "Welcome {{ recipient.name }}" } },
        { channel: "email", template: { subject: "Hi", body: "Hello {{ recipient.name }}" } },
      ],
    },
  ],
};

export function createKnockTestApp(seed: KnockSeedConfig = defaultSdkSeed, baseUrl = "http://localhost:4000"): KnockTestApp {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();

  const app = new Hono<AppEnv>();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  app.use("*", authMiddleware(tokenMap));
  knockPlugin.register(app, store, webhooks, baseUrl, tokenMap);
  seedFromConfig(store, baseUrl, seed);

  return { app, store, webhooks, tokenMap };
}

export async function startKnockTestEmulator(
  customize?: (setup: KnockTestApp) => void | Promise<void>,
  seed: KnockSeedConfig = defaultSdkSeed,
): Promise<KnockTestEmulator> {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();

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
  knockPlugin.register(app, store, webhooks, url, tokenMap);
  seedFromConfig(store, url, seed);

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
