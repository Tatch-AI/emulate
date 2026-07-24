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
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { anthropicPlugin, seedFromConfig, type AnthropicSeedConfig } from "../index.js";

export const base = "http://localhost:4000";
export const TEST_API_KEY = "sk-ant-test-key";
export const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicTestApp {
  app: Hono<AppEnv>;
  store: Store;
  webhooks: WebhookDispatcher;
}

export function createTestApp(seed?: AnthropicSeedConfig): AnthropicTestApp {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();
  const app = new Hono<AppEnv>();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  anthropicPlugin.register(app, store, webhooks, base, tokenMap);
  if (seed) seedFromConfig(store, base, seed);
  return { app, store, webhooks };
}

export function apiHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "x-api-key": TEST_API_KEY,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
    ...extra,
  };
}

export function bearerHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${TEST_API_KEY}`,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
    ...extra,
  };
}

export interface AnthropicTestEmulator extends AnthropicTestApp {
  url: string;
  close: () => Promise<void>;
}

export async function startAnthropicTestEmulator(seed?: AnthropicSeedConfig): Promise<AnthropicTestEmulator> {
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
  anthropicPlugin.register(app, store, webhooks, url, tokenMap);
  if (seed) seedFromConfig(store, url, seed);

  return {
    app,
    store,
    webhooks,
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export async function readJson(res: Response): Promise<any> {
  return res.json();
}

export function parseSse(text: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const blocks = text.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (event) {
      events.push({ event, data: data ? JSON.parse(data) : null });
    }
  }
  return events;
}
