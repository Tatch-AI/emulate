import type { Hono } from "@emulators/core";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import { generateUuid, nextFlagId, nextProjectId } from "./helpers.js";
import { captureRoutes } from "./routes/capture.js";
import { decideRoutes } from "./routes/decide.js";
import { inspectorRoutes } from "./routes/inspector.js";
import { localEvaluationRoutes } from "./routes/local-evaluation.js";
import { privateApiRoutes } from "./routes/private-api.js";
import { getPostHogStore } from "./store.js";
import type { PostHogFlagFilters } from "./entities.js";

export { getPostHogStore, type PostHogStore } from "./store.js";
export * from "./entities.js";
export { posthogHash, LONG_SCALE } from "./helpers.js";

export const DEFAULT_PROJECT_API_KEY = "phc_test_key";
export const DEFAULT_PERSONAL_API_KEY = "phx_test_personal";
export const DEFAULT_PROJECT_ID = 1;
export const DEFAULT_PROJECT_NAME = "Default project";

export interface PostHogSeedConfig {
  port?: number;
  project?: {
    id?: number;
    name?: string;
    api_key?: string;
  };
  personal_api_keys?: string[];
  feature_flags?: Array<{
    key: string;
    name?: string;
    active?: boolean;
    filters?: PostHogFlagFilters;
    ensure_experience_continuity?: boolean;
    rollout_percentage?: number | null;
  }>;
  persons?: Array<{
    distinct_ids: string[];
    properties?: Record<string, unknown>;
  }>;
}

function seedDefaults(store: Store): void {
  seedFromConfig(store, "", {
    project: {
      id: DEFAULT_PROJECT_ID,
      name: DEFAULT_PROJECT_NAME,
      api_key: DEFAULT_PROJECT_API_KEY,
    },
    personal_api_keys: [DEFAULT_PERSONAL_API_KEY],
    feature_flags: [
      {
        key: "beta-feature",
        name: "Beta feature",
        active: true,
        filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
      },
    ],
  });
}

export function seedFromConfig(store: Store, _baseUrl: string, config: PostHogSeedConfig): void {
  const ps = getPostHogStore(store);

  const projectId = config.project?.id ?? DEFAULT_PROJECT_ID;
  const apiKey = config.project?.api_key ?? DEFAULT_PROJECT_API_KEY;
  const name = config.project?.name ?? DEFAULT_PROJECT_NAME;

  let project = ps.projects.findOneBy("api_key", apiKey) ?? ps.projects.findOneBy("project_id", projectId);
  if (!project) {
    project = ps.projects.insert({
      project_id: projectId > 0 ? projectId : nextProjectId(ps),
      uuid: generateUuid(),
      name,
      api_key: apiKey,
    });
  } else {
    project = ps.projects.update(project.id, {
      name,
      api_key: apiKey,
      project_id: projectId > 0 ? projectId : project.project_id,
    })!;
  }

  for (const key of config.personal_api_keys ?? []) {
    const existing = ps.personalApiKeys.findOneBy("key", key);
    if (existing) {
      ps.personalApiKeys.update(existing.id, { project_id: project.project_id, label: existing.label });
      continue;
    }
    ps.personalApiKeys.insert({
      key,
      label: "Seeded personal API key",
      project_id: project.project_id,
    });
  }

  for (const flagCfg of config.feature_flags ?? []) {
    const existing = ps.featureFlags
      .all()
      .find((flag) => flag.project_id === project.project_id && flag.key === flagCfg.key && !flag.deleted);
    const filters = flagCfg.filters ?? { groups: [{ properties: [], rollout_percentage: 100 }] };
    if (existing) {
      ps.featureFlags.update(existing.id, {
        name: flagCfg.name ?? existing.name,
        active: flagCfg.active ?? existing.active,
        filters,
        ensure_experience_continuity: flagCfg.ensure_experience_continuity ?? existing.ensure_experience_continuity,
        rollout_percentage:
          flagCfg.rollout_percentage !== undefined ? flagCfg.rollout_percentage : existing.rollout_percentage,
        version: existing.version + 1,
      });
      continue;
    }
    ps.featureFlags.insert({
      flag_id: nextFlagId(ps),
      project_id: project.project_id,
      key: flagCfg.key,
      name: flagCfg.name ?? flagCfg.key,
      active: flagCfg.active !== false,
      deleted: false,
      filters,
      ensure_experience_continuity: Boolean(flagCfg.ensure_experience_continuity),
      rollout_percentage: flagCfg.rollout_percentage ?? null,
      version: 1,
    });
  }

  for (const personCfg of config.persons ?? []) {
    const distinctIds = personCfg.distinct_ids ?? [];
    if (distinctIds.length === 0) continue;
    const existing = ps.persons
      .all()
      .find(
        (person) =>
          person.project_id === project.project_id &&
          person.distinct_ids.some((id) => distinctIds.includes(id)),
      );
    if (existing) {
      ps.persons.update(existing.id, {
        distinct_ids: Array.from(new Set([...existing.distinct_ids, ...distinctIds])),
        properties: { ...existing.properties, ...(personCfg.properties ?? {}) },
      });
      continue;
    }
    ps.persons.insert({
      uuid: generateUuid(),
      project_id: project.project_id,
      distinct_ids: distinctIds,
      properties: personCfg.properties ?? {},
    });
  }
}

export const posthogPlugin: ServicePlugin = {
  name: "posthog",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    captureRoutes(ctx);
    decideRoutes(ctx);
    localEvaluationRoutes(ctx);
    privateApiRoutes(ctx);
    inspectorRoutes(ctx);
  },
  seed(store: Store): void {
    seedDefaults(store);
  },
};

export default posthogPlugin;
