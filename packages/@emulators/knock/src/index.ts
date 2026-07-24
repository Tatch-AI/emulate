import type { Hono } from "@emulators/core";
import type { ServicePlugin, Store, WebhookDispatcher, TokenMap, AppEnv, RouteContext } from "@emulators/core";
import { getKnockStore } from "./store.js";
import { generateUuid } from "./helpers.js";
import type { KnockChannelType, KnockWorkflowStep } from "./entities.js";
import { workflowRoutes } from "./routes/workflows.js";
import { userRoutes } from "./routes/users.js";
import { messageRoutes } from "./routes/messages.js";
import { feedRoutes } from "./routes/feeds.js";
import { objectRoutes } from "./routes/objects.js";
import { preferenceRoutes } from "./routes/preferences.js";
import { tenantRoutes } from "./routes/tenants.js";
import { inspectorRoutes } from "./routes/inspector.js";

export { getKnockStore, type KnockStore } from "./store.js";
export * from "./entities.js";

export interface KnockSeedConfig {
  port?: number;
  api_keys?: Array<string | { key: string; name?: string; type?: "secret" | "public" }>;
  channels?: Array<{
    id?: string;
    key?: string;
    type: KnockChannelType;
    name?: string;
  }>;
  workflows?: Array<{
    key: string;
    name?: string;
    steps: Array<{
      channel: string;
      template?: { subject?: string; body?: string };
    }>;
  }>;
  users?: Array<{
    id: string;
    name?: string;
    email?: string;
    phone_number?: string;
    avatar?: string;
    [key: string]: unknown;
  }>;
  tenants?: Array<{
    id: string;
    name?: string;
    settings?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
  objects?: Array<{
    collection: string;
    id: string;
    [key: string]: unknown;
  }>;
}

function inferKeyType(key: string): "secret" | "public" {
  if (key.startsWith("pk_")) return "public";
  return "secret";
}

export function seedFromConfig(store: Store, _baseUrl: string, config: KnockSeedConfig): void {
  const ks = getKnockStore(store);

  if (config.api_keys) {
    for (const raw of config.api_keys) {
      const key = typeof raw === "string" ? raw : raw.key;
      const name = typeof raw === "string" ? key : (raw.name ?? key);
      const type = typeof raw === "string" ? inferKeyType(key) : (raw.type ?? inferKeyType(key));
      if (ks.apiKeys.findOneBy("key", key)) continue;
      ks.apiKeys.insert({ key, name, type });
    }
  }

  if (config.channels) {
    for (const ch of config.channels) {
      const key = ch.key ?? ch.id ?? ch.type;
      const channelId = ch.id ?? ch.key ?? generateUuid();
      const existing =
        ks.channels.findOneBy("channel_id", channelId) ?? ks.channels.findOneBy("key", key);
      if (existing) continue;
      ks.channels.insert({
        channel_id: channelId,
        key,
        type: ch.type,
        name: ch.name ?? key,
      });
    }
  }

  if (config.workflows) {
    for (const wf of config.workflows) {
      const steps: KnockWorkflowStep[] = (wf.steps ?? []).map((s) => ({
        channel: s.channel,
        template: s.template ?? {},
      }));
      const existing = ks.workflows.findOneBy("key", wf.key);
      if (existing) {
        ks.workflows.update(existing.id, {
          name: wf.name ?? existing.name,
          steps,
        });
        continue;
      }
      ks.workflows.insert({
        key: wf.key,
        name: wf.name ?? wf.key,
        steps,
        version_id: generateUuid(),
      });
    }
  }

  if (config.users) {
    for (const u of config.users) {
      if (ks.users.findOneBy("user_id", u.id)) continue;
      const reserved = new Set(["id", "name", "email", "phone_number", "avatar"]);
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(u)) {
        if (!reserved.has(k)) properties[k] = v;
      }
      ks.users.insert({
        user_id: u.id,
        name: u.name ?? null,
        email: u.email ?? null,
        phone_number: u.phone_number ?? null,
        avatar: u.avatar ?? null,
        properties,
      });
    }
  }

  if (config.tenants) {
    for (const t of config.tenants) {
      if (ks.tenants.findOneBy("tenant_id", t.id)) continue;
      const reserved = new Set(["id", "name", "settings"]);
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(t)) {
        if (!reserved.has(k)) properties[k] = v;
      }
      ks.tenants.insert({
        tenant_id: t.id,
        name: t.name ?? null,
        settings: t.settings ?? {},
        properties,
      });
    }
  }

  if (config.objects) {
    for (const o of config.objects) {
      const existing = ks.objects
        .all()
        .find((x) => x.collection === o.collection && x.object_id === o.id);
      if (existing) continue;
      const reserved = new Set(["id", "collection"]);
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) {
        if (!reserved.has(k)) properties[k] = v;
      }
      ks.objects.insert({
        collection: o.collection,
        object_id: o.id,
        properties,
      });
    }
  }
}

export const knockPlugin: ServicePlugin = {
  name: "knock",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    // More specific routes first where order matters within shared prefixes.
    workflowRoutes(ctx);
    preferenceRoutes(ctx);
    feedRoutes(ctx);
    userRoutes(ctx);
    messageRoutes(ctx);
    objectRoutes(ctx);
    tenantRoutes(ctx);
    inspectorRoutes(ctx);
  },
  seed(_store: Store, _baseUrl: string): void {
    // No default seed; use seedFromConfig via emulator config.
  },
};

export default knockPlugin;
