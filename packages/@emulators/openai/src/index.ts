import type { Hono } from "@emulators/core";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import { DEFAULT_MODELS, unixNow } from "./helpers.js";
import { getOpenAIStore } from "./store.js";
import { chatRoutes } from "./routes/chat.js";
import { responseRoutes } from "./routes/responses.js";
import { embeddingRoutes } from "./routes/embeddings.js";
import { modelRoutes } from "./routes/models.js";
import { audioRoutes } from "./routes/audio.js";
import { moderationRoutes } from "./routes/moderations.js";
import { fileRoutes } from "./routes/files.js";
import { batchRoutes } from "./routes/batches.js";
import { inspectorRoutes } from "./routes/inspector.js";

export { getOpenAIStore, type OpenAIStore } from "./store.js";
export * from "./entities.js";

export interface OpenAISeedConfig {
  port?: number;
  api_keys?: string[];
  models?: string[];
  responses?: Array<{
    match?: {
      model?: string;
      content_contains?: string;
    };
    reply: string;
    tool_call?: {
      name: string;
      arguments?: string | Record<string, unknown>;
    };
  }>;
  transcripts?: Array<{
    filename_contains?: string;
    text: string;
  }>;
  moderation_triggers?: Array<{
    contains: string;
    categories?: string[];
  }>;
}

function seedDefaultModels(store: Store): void {
  const os = getOpenAIStore(store);
  const created = 1_700_000_000;
  for (const model of DEFAULT_MODELS) {
    if (os.models.findOneBy("model_id", model.id)) continue;
    os.models.insert({
      model_id: model.id,
      created,
      owned_by: model.owned_by,
    });
  }
}

export function seedFromConfig(store: Store, _baseUrl: string, config: OpenAISeedConfig): void {
  const os = getOpenAIStore(store);
  seedDefaultModels(store);

  if (config.api_keys) {
    for (const key of config.api_keys) {
      if (os.apiKeys.findOneBy("key", key)) continue;
      os.apiKeys.insert({
        key,
        name: key.startsWith("sk-") ? "seeded" : "local",
      });
    }
  }

  if (config.models) {
    for (const modelId of config.models) {
      if (os.models.findOneBy("model_id", modelId)) continue;
      os.models.insert({
        model_id: modelId,
        created: unixNow(),
        owned_by: "custom",
      });
    }
  }

  if (config.responses) {
    let order = os.responseMatchers.count();
    for (const matcher of config.responses) {
      const matchModel = matcher.match?.model ?? null;
      const contentContains = matcher.match?.content_contains ?? null;
      const existing = os.responseMatchers.all().find(
        (m) =>
          m.match_model === matchModel &&
          m.content_contains === contentContains &&
          m.reply === matcher.reply &&
          m.tool_call_name === (matcher.tool_call?.name ?? null),
      );
      if (existing) continue;

      const args = matcher.tool_call?.arguments;
      os.responseMatchers.insert({
        match_model: matchModel,
        content_contains: contentContains,
        reply: matcher.reply,
        tool_call_name: matcher.tool_call?.name ?? null,
        tool_call_arguments:
          args == null ? null : typeof args === "string" ? args : JSON.stringify(args),
        order: order++,
      });
    }
  }

  if (config.transcripts) {
    for (const transcript of config.transcripts) {
      const filenameContains = transcript.filename_contains ?? null;
      const existing = os.transcripts
        .all()
        .find((t) => t.filename_contains === filenameContains && t.text === transcript.text);
      if (existing) continue;
      os.transcripts.insert({
        filename_contains: filenameContains,
        text: transcript.text,
      });
    }
  }

  if (config.moderation_triggers) {
    for (const trigger of config.moderation_triggers) {
      const categories = trigger.categories ?? ["hate", "violence"];
      const existing = os.moderationTriggers
        .all()
        .find(
          (t) =>
            t.contains === trigger.contains &&
            t.categories.join(",") === categories.join(","),
        );
      if (existing) continue;
      os.moderationTriggers.insert({
        contains: trigger.contains,
        categories,
      });
    }
  }
}

export const openaiPlugin: ServicePlugin = {
  name: "openai",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    inspectorRoutes(ctx);
    chatRoutes(ctx);
    responseRoutes(ctx);
    embeddingRoutes(ctx);
    modelRoutes(ctx);
    audioRoutes(ctx);
    moderationRoutes(ctx);
    fileRoutes(ctx);
    batchRoutes(ctx);
  },
  seed(store: Store, _baseUrl: string): void {
    seedDefaultModels(store);
  },
};

export default openaiPlugin;
