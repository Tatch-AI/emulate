import type { Context, RouteContext } from "@emulators/core";
import {
  extractApiKey,
  formatFeatureFlag,
  posthogAuthError,
  requirePersonalApiKey,
  resolveProjectByApiKey,
} from "../helpers.js";
import { getPostHogStore } from "../store.js";

export function localEvaluationRoutes({ app, store }: RouteContext): void {
  const ps = () => getPostHogStore(store);

  const handler = (c: Context) => {
    const auth = requirePersonalApiKey(c, ps());
    if (auth !== true) return auth;

    const token = c.req.query("token");
    const project = resolveProjectByApiKey(ps(), token ?? extractApiKey({}));
    if (!project) return posthogAuthError(c, "Invalid project API key.");

    const flags = ps()
      .featureFlags.all()
      .filter((flag) => flag.project_id === project.project_id && !flag.deleted)
      .map((flag) => formatFeatureFlag(flag));

    return c.json({
      flags,
      group_type_mapping: {},
      cohorts: {},
    });
  };

  app.get("/api/feature_flag/local_evaluation", handler);
  app.get("/api/feature_flag/local_evaluation/", handler);
  // Newer posthog-node SDKs poll this path instead of local_evaluation.
  app.get("/flags/definitions", handler);
  app.get("/flags/definitions/", handler);
}
