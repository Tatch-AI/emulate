import type { Hono } from "@emulators/core";
import type { ServicePlugin, Store, WebhookDispatcher, TokenMap, AppEnv, RouteContext } from "@emulators/core";
import { getDeepgramStore } from "./store.js";
import { generateUuid } from "./helpers.js";
import type { DeepgramTranscriptMatcher } from "./entities.js";
import { listenRoutes } from "./routes/listen.js";
import { speakRoutes } from "./routes/speak.js";
import { readRoutes } from "./routes/read.js";
import { authRoutes } from "./routes/auth.js";
import { projectsRoutes } from "./routes/projects.js";
import { inspectorRoutes } from "./routes/inspector.js";

export { getDeepgramStore, type DeepgramStore } from "./store.js";
export * from "./entities.js";

export interface DeepgramSeedConfig {
  port?: number;
  api_keys?: Array<string | { key: string; project?: string; scopes?: string[]; comment?: string }>;
  projects?: Array<{ name: string; company?: string; project_id?: string }>;
  transcripts?: DeepgramTranscriptMatcher[];
  read?: DeepgramTranscriptMatcher[];
  speak?: { model?: string };
}

function ensureDefaultProject(store: Store, name = "Default", company?: string): string {
  const ds = getDeepgramStore(store);
  const existing = ds.projects.findOneBy("name", name);
  if (existing) return existing.project_id;

  const project_id = generateUuid();
  ds.projects.insert({
    project_id,
    name,
    company: company ?? null,
  });
  ds.members.insert({
    member_id: generateUuid(),
    project_id,
    email: "owner@emulate.dev",
    first_name: "Owner",
    last_name: "User",
    scopes: ["admin"],
  });
  return project_id;
}

export function seedFromConfig(store: Store, _baseUrl: string, config: DeepgramSeedConfig): void {
  const ds = getDeepgramStore(store);

  const projectIdsByName = new Map<string, string>();
  if (config.projects && config.projects.length > 0) {
    for (const p of config.projects) {
      const existing = ds.projects.findOneBy("name", p.name);
      if (existing) {
        projectIdsByName.set(p.name, existing.project_id);
        continue;
      }
      const project_id = p.project_id ?? generateUuid();
      ds.projects.insert({
        project_id,
        name: p.name,
        company: p.company ?? null,
      });
      ds.members.insert({
        member_id: generateUuid(),
        project_id,
        email: "owner@emulate.dev",
        first_name: "Owner",
        last_name: "User",
        scopes: ["admin"],
      });
      projectIdsByName.set(p.name, project_id);
    }
  } else if (ds.projects.count() === 0) {
    const id = ensureDefaultProject(store);
    projectIdsByName.set("Default", id);
  } else {
    for (const p of ds.projects.all()) {
      projectIdsByName.set(p.name, p.project_id);
    }
  }

  const defaultProjectId =
    projectIdsByName.values().next().value ?? ensureDefaultProject(store);

  if (config.api_keys) {
    for (const entry of config.api_keys) {
      const key = typeof entry === "string" ? entry : entry.key;
      if (ds.apiKeys.findOneBy("key", key)) continue;

      const projectName = typeof entry === "string" ? undefined : entry.project;
      const project_id = projectName
        ? (projectIdsByName.get(projectName) ?? ensureDefaultProject(store, projectName))
        : defaultProjectId;
      const member = ds.members.findBy("project_id", project_id)[0];
      ds.apiKeys.insert({
        api_key_id: generateUuid(),
        key,
        project_id,
        comment: typeof entry === "string" ? "seeded" : (entry.comment ?? "seeded"),
        scopes: typeof entry === "string" ? ["member"] : (entry.scopes ?? ["member"]),
        created: new Date().toISOString(),
        expiration_date: null,
        member_id: member?.member_id ?? generateUuid(),
        member_email: member?.email ?? "owner@emulate.dev",
      });
    }
  }

  if (config.transcripts) {
    ds.setTranscriptMatchers(config.transcripts);
  }

  if (config.read) {
    ds.setReadMatchers(config.read);
  }

  if (config.speak?.model) {
    ds.setDefaultSpeakModel(config.speak.model);
  }
}

export const deepgramPlugin: ServicePlugin = {
  name: "deepgram",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    listenRoutes(ctx);
    speakRoutes(ctx);
    readRoutes(ctx);
    authRoutes(ctx);
    projectsRoutes(ctx);
    inspectorRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedFromConfig(store, baseUrl, {
      projects: [{ name: "Default" }],
      api_keys: ["deepgram_test_key"],
    });
  },
};

export default deepgramPlugin;
