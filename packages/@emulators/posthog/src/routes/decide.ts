import type { RouteContext } from "@emulators/core";
import { evaluateAllFlags, toDecideV3, toDecideV4, toFlagsV2 } from "../evaluate.js";
import {
  extractApiKey,
  findPersonByDistinctId,
  parsePostHogBody,
  posthogAuthError,
  resolveProjectByApiKey,
} from "../helpers.js";
import { getPostHogStore } from "../store.js";

export function decideRoutes({ app, store }: RouteContext): void {
  const ps = () => getPostHogStore(store);

  const decidePaths = ["/decide/", "/decide"];
  for (const path of decidePaths) {
    app.post(path, async (c) => {
      const body = await parsePostHogBody(c);
      const apiKey = extractApiKey(body, c.req.query("token") ?? undefined);
      const project = resolveProjectByApiKey(ps(), apiKey);
      if (!project) return posthogAuthError(c);

      const distinctId = String(body.distinct_id ?? "");
      const personProperties = mergePersonProperties(ps(), project.project_id, distinctId, body);
      const flags = ps()
        .featureFlags.all()
        .filter((flag) => flag.project_id === project.project_id && !flag.deleted);
      const results = evaluateAllFlags(flags, distinctId, personProperties);

      const version = c.req.query("v") ?? "3";
      ps().decideLogs.insert({
        project_id: project.project_id,
        distinct_id: distinctId,
        path: path,
        version,
        flag_count: Object.keys(results).length,
        request_body: body,
      });

      if (version === "4") return c.json(toDecideV4(results));
      return c.json(toDecideV3(results));
    });
  }

  const flagsPaths = ["/flags/", "/flags"];
  for (const path of flagsPaths) {
    app.post(path, async (c) => {
      const body = await parsePostHogBody(c);
      const apiKey = extractApiKey(body, c.req.query("token") ?? undefined);
      const project = resolveProjectByApiKey(ps(), apiKey);
      if (!project) return posthogAuthError(c);

      const distinctId = String(body.distinct_id ?? "");
      const personProperties = mergePersonProperties(ps(), project.project_id, distinctId, body);
      const flags = ps()
        .featureFlags.all()
        .filter((flag) => flag.project_id === project.project_id && !flag.deleted);
      const results = evaluateAllFlags(flags, distinctId, personProperties);

      const version = c.req.query("v") ?? "2";
      ps().decideLogs.insert({
        project_id: project.project_id,
        distinct_id: distinctId,
        path,
        version,
        flag_count: Object.keys(results).length,
        request_body: body,
      });

      return c.json(toFlagsV2(results));
    });
  }
}

function mergePersonProperties(
  ps: ReturnType<typeof getPostHogStore>,
  projectId: number,
  distinctId: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  const person = findPersonByDistinctId(ps, projectId, distinctId);
  const override =
    body.person_properties && typeof body.person_properties === "object" && !Array.isArray(body.person_properties)
      ? (body.person_properties as Record<string, unknown>)
      : {};
  return { ...(person?.properties ?? {}), ...override };
}
