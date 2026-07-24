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
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { openaiPlugin, seedFromConfig, type OpenAISeedConfig } from "../index.js";

export const openaiTestBaseUrl = "http://localhost:4000";
export const openaiTestKey = "sk-test-openai-key";

export interface OpenAITestApp {
  app: Hono<AppEnv>;
  store: Store;
  webhooks: WebhookDispatcher;
  tokenMap: TokenMap;
}

export interface OpenAITestEmulator extends OpenAITestApp {
  url: string;
  close: () => Promise<void>;
}

export function createOpenAITestApp(seed?: OpenAISeedConfig): OpenAITestApp {
  const store = new Store();
  const webhooks = new WebhookDispatcher();
  const tokenMap: TokenMap = new Map();

  const app = new Hono<AppEnv>();
  app.onError(createApiErrorHandler());
  app.use("*", createErrorHandler());
  openaiPlugin.register(app, store, webhooks, openaiTestBaseUrl, tokenMap);
  openaiPlugin.seed?.(store, openaiTestBaseUrl);
  if (seed) seedFromConfig(store, openaiTestBaseUrl, seed);

  return { app, store, webhooks, tokenMap };
}

export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${openaiTestKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

export async function startOpenAITestEmulator(seed?: OpenAISeedConfig): Promise<OpenAITestEmulator> {
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
  openaiPlugin.register(app, store, webhooks, url, tokenMap);
  openaiPlugin.seed?.(store, url);
  if (seed) seedFromConfig(store, url, seed);

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

export function parseSseDataLines(text: string): unknown[] {
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6).trim();
    if (payload === "[DONE]") continue;
    out.push(JSON.parse(payload));
  }
  return out;
}

export function parseSseEvents(text: string): Array<{ event: string; data: unknown }> {
  const events: Array<{ event: string; data: unknown }> = [];
  const blocks = text.split("\n\n").filter(Boolean);
  for (const block of blocks) {
    const lines = block.split("\n");
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      if (line.startsWith("data: ")) data = line.slice(6);
    }
    if (data) events.push({ event, data: JSON.parse(data) });
  }
  return events;
}
