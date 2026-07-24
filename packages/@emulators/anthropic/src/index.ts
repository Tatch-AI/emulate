import type { Hono } from "@emulators/core";
import type { ServicePlugin, Store, WebhookDispatcher, TokenMap, AppEnv, RouteContext } from "@emulators/core";
import { getAnthropicStore, setResponseMatchers } from "./store.js";
import type { AnthropicSeedConfig } from "./entities.js";
import { anthropicApiGuard } from "./helpers.js";
import { messageRoutes } from "./routes/messages.js";
import { modelRoutes } from "./routes/models.js";
import { batchRoutes } from "./routes/batches.js";
import { inspectorRoutes } from "./routes/inspector.js";

export { getAnthropicStore, type AnthropicStore } from "./store.js";
export * from "./entities.js";

const DEFAULT_MODELS: Array<{ id: string; display_name: string; created_at: string; alias_of?: string }> = [
  { id: "claude-opus-4-1", display_name: "Claude Opus 4.1", created_at: "2025-08-05T00:00:00.000Z" },
  { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5", created_at: "2025-09-29T00:00:00.000Z" },
  { id: "claude-sonnet-4-0", display_name: "Claude Sonnet 4", created_at: "2025-05-22T00:00:00.000Z" },
  {
    id: "claude-3-7-sonnet-latest",
    display_name: "Claude Sonnet 3.7",
    created_at: "2025-02-19T00:00:00.000Z",
  },
  {
    id: "claude-3-5-haiku-latest",
    display_name: "Claude Haiku 3.5",
    created_at: "2024-10-22T00:00:00.000Z",
  },
  {
    id: "claude-3-5-haiku-20241022",
    display_name: "Claude Haiku 3.5",
    created_at: "2024-10-22T00:00:00.000Z",
    alias_of: "claude-3-5-haiku-latest",
  },
  {
    id: "claude-3-7-sonnet-20250219",
    display_name: "Claude Sonnet 3.7",
    created_at: "2025-02-19T00:00:00.000Z",
    alias_of: "claude-3-7-sonnet-latest",
  },
  {
    id: "claude-sonnet-4-20250514",
    display_name: "Claude Sonnet 4",
    created_at: "2025-05-14T00:00:00.000Z",
    alias_of: "claude-sonnet-4-0",
  },
  {
    id: "claude-opus-4-1-20250805",
    display_name: "Claude Opus 4.1",
    created_at: "2025-08-05T00:00:00.000Z",
    alias_of: "claude-opus-4-1",
  },
  {
    id: "claude-sonnet-4-5-20250929",
    display_name: "Claude Sonnet 4.5",
    created_at: "2025-09-29T00:00:00.000Z",
    alias_of: "claude-sonnet-4-5",
  },
];

export type { AnthropicSeedConfig };

export function seedFromConfig(store: Store, _baseUrl: string, config: AnthropicSeedConfig): void {
  const as = getAnthropicStore(store);

  if (config.api_keys) {
    for (const entry of config.api_keys) {
      const key = typeof entry === "string" ? entry : entry.key;
      const name = typeof entry === "string" ? "default" : (entry.name ?? "default");
      if (!key) continue;
      if (as.apiKeys.findOneBy("key", key)) continue;
      as.apiKeys.insert({ key, name });
    }
  }

  if (config.models) {
    for (const model of config.models) {
      if (as.models.findOneBy("model_id", model.id)) continue;
      as.models.insert({
        model_id: model.id,
        display_name: model.display_name ?? model.id,
        created_at_iso: new Date().toISOString(),
        alias_of: model.alias_of ?? null,
      });
    }
  }

  if (config.responses) {
    setResponseMatchers(store, config.responses);
  }
}

function seedDefaultModels(store: Store): void {
  const as = getAnthropicStore(store);
  for (const model of DEFAULT_MODELS) {
    if (as.models.findOneBy("model_id", model.id)) continue;
    as.models.insert({
      model_id: model.id,
      display_name: model.display_name,
      created_at_iso: model.created_at,
      alias_of: model.alias_of ?? null,
    });
  }
}

export const anthropicPlugin: ServicePlugin = {
  name: "anthropic",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    seedDefaultModels(store);
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    app.use("*", async (c, next) => {
      if (!c.req.path.startsWith("/v1/")) {
        await next();
        return;
      }
      return anthropicApiGuard(() => getAnthropicStore(store))(c, next);
    });
    messageRoutes(ctx);
    modelRoutes(ctx);
    batchRoutes(ctx);
    inspectorRoutes(ctx);
  },
  seed(store: Store, _baseUrl: string): void {
    seedDefaultModels(store);
  },
};

export default anthropicPlugin;
