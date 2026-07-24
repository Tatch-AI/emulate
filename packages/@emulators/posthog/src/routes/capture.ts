import type { RouteContext } from "@emulators/core";
import { getPostHogStore } from "../store.js";
import {
  ensureProject,
  extractApiKey,
  generateUuid,
  mergePersons,
  parsePostHogBody,
  posthogAuthError,
  resolveProjectByApiKey,
  upsertPerson,
} from "../helpers.js";
import type { PostHogProject } from "../entities.js";
import type { PostHogStore } from "../store.js";

type CaptureEventInput = {
  uuid?: string;
  event?: string;
  distinct_id?: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  $set?: Record<string, unknown>;
  $set_once?: Record<string, unknown>;
};

export function captureRoutes({ app, store }: RouteContext): void {
  const ps = () => getPostHogStore(store);

  const paths = [
    "/capture/",
    "/capture",
    "/batch/",
    "/batch",
    "/e/",
    "/e",
    "/i/v0/e/",
    "/i/v0/e",
  ];

  for (const path of paths) {
    app.post(path, async (c) => {
      const body = await parsePostHogBody(c);
      const apiKey = extractApiKey(body);
      const project = resolveProjectByApiKey(ps(), apiKey);
      if (!project) return posthogAuthError(c);

      const liveProject = project.id > 0 ? project : ensureProject(ps(), apiKey!);
      ingestBody(ps(), liveProject, body);

      const isModern = path.includes("/i/v0/e");
      return c.json(isModern ? { status: "Ok" } : { status: 1 });
    });
  }
}

function ingestBody(ps: PostHogStore, project: PostHogProject, body: Record<string, unknown>): void {
  if (Array.isArray(body.batch)) {
    for (const item of body.batch) {
      if (item && typeof item === "object") {
        processEvent(ps, project, item as CaptureEventInput);
      }
    }
    return;
  }

  processEvent(ps, project, body as CaptureEventInput);
}

export function processEvent(ps: PostHogStore, project: PostHogProject, input: CaptureEventInput): void {
  const eventName = typeof input.event === "string" ? input.event : "$pageview";
  const distinctId = String(input.distinct_id ?? input.properties?.distinct_id ?? "anonymous");
  const properties =
    input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)
      ? { ...input.properties }
      : {};

  const setFromProps =
    properties.$set && typeof properties.$set === "object" && !Array.isArray(properties.$set)
      ? (properties.$set as Record<string, unknown>)
      : undefined;
  const setOnceFromProps =
    properties.$set_once && typeof properties.$set_once === "object" && !Array.isArray(properties.$set_once)
      ? (properties.$set_once as Record<string, unknown>)
      : undefined;

  const setProps = {
    ...(typeof input.$set === "object" && input.$set ? input.$set : {}),
    ...(setFromProps ?? {}),
  };
  const setOnceProps = {
    ...(typeof input.$set_once === "object" && input.$set_once ? input.$set_once : {}),
    ...(setOnceFromProps ?? {}),
  };

  if (eventName === "$identify") {
    const identified =
      (properties.$user_id as string | undefined) ??
      (properties.distinct_id as string | undefined) ??
      distinctId;
    const anon = properties.$anon_distinct_id as string | undefined;
    if (anon && anon !== identified) {
      mergePersons(ps, project.project_id, String(identified), String(anon));
    }
    upsertPerson(ps, project.project_id, String(identified), setProps, setOnceProps);
  } else if (eventName === "$create_alias" || eventName === "$merge_dangerously") {
    const alias = String(properties.alias ?? properties.$user_id ?? "");
    if (alias) {
      mergePersons(ps, project.project_id, distinctId, alias);
    } else {
      upsertPerson(ps, project.project_id, distinctId, setProps, setOnceProps);
    }
  } else {
    upsertPerson(
      ps,
      project.project_id,
      distinctId,
      Object.keys(setProps).length ? setProps : undefined,
      Object.keys(setOnceProps).length ? setOnceProps : undefined,
    );
  }

  const timestamp =
    typeof input.timestamp === "string" && input.timestamp
      ? input.timestamp
      : typeof properties.timestamp === "string"
        ? (properties.timestamp as string)
        : new Date().toISOString();

  ps.events.insert({
    uuid: typeof input.uuid === "string" ? input.uuid : generateUuid(),
    project_id: project.project_id,
    event: eventName,
    distinct_id: distinctId,
    properties,
    timestamp,
  });
}
