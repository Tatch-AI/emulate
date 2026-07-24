import { createHash, randomUUID } from "node:crypto";
import { gunzipSync, inflateSync } from "node:zlib";
import type { Context, ContentfulStatusCode } from "@emulators/core";
import type { PostHogPerson, PostHogProject, PostHogPropertyFilter } from "./entities.js";
import type { PostHogStore } from "./store.js";

export const LONG_SCALE = 0xfffffffffffffff;

export function generateUuid(): string {
  return randomUUID();
}

export function posthogAuthError(c: Context, detail = "Invalid API key.") {
  return c.json(
    {
      type: "authentication_error",
      code: "invalid_api_key",
      detail,
      attr: null,
    },
    401 as ContentfulStatusCode,
  );
}

export function posthogError(c: Context, status: number, type: string, code: string, detail: string) {
  return c.json({ type, code, detail, attr: null }, status as ContentfulStatusCode);
}

export function maskKey(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/** PostHog rollout hash: SHA1 of `<key>.<distinct_id><salt>`, first 15 hex chars / LONG_SCALE. */
export function posthogHash(key: string, distinctId: string, salt = ""): number {
  const hashKey = `${key}.${distinctId}${salt}`;
  const digest = createHash("sha1").update(hashKey, "utf8").digest("hex");
  return parseInt(digest.slice(0, 15), 16) / LONG_SCALE;
}

export function getBearerToken(c: Context): string | null {
  const header = c.req.header("Authorization") ?? "";
  const match = header.match(/^(?:Bearer|token)\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function requirePersonalApiKey(c: Context, ps: PostHogStore): Response | true {
  const token = getBearerToken(c);
  if (!token) return posthogAuthError(c, "Personal API key required.");
  const seeded = ps.personalApiKeys.all();
  if (seeded.length === 0) {
    if (token.startsWith("phx_") || token.startsWith("phs_")) return true;
    return posthogAuthError(c, "Personal API key required.");
  }
  if (!ps.personalApiKeys.findOneBy("key", token)) {
    return posthogAuthError(c, "Invalid personal API key.");
  }
  return true;
}

export function resolveProjectByApiKey(ps: PostHogStore, apiKey: string | undefined | null): PostHogProject | null {
  if (!apiKey || typeof apiKey !== "string") return null;
  const seeded = ps.projects.all();
  if (seeded.length === 0) {
    if (!apiKey.startsWith("phc_")) return null;
    return {
      id: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      project_id: 1,
      uuid: "00000000-0000-0000-0000-000000000001",
      name: "Ephemeral project",
      api_key: apiKey,
    };
  }
  return ps.projects.findOneBy("api_key", apiKey) ?? null;
}

export function ensureProject(ps: PostHogStore, apiKey: string): PostHogProject {
  const existing = resolveProjectByApiKey(ps, apiKey);
  if (existing && existing.id > 0) return existing;
  if (existing) {
    const inserted = ps.projects.findOneBy("api_key", apiKey);
    if (inserted) return inserted;
    return ps.projects.insert({
      project_id: existing.project_id,
      uuid: existing.uuid,
      name: existing.name,
      api_key: apiKey,
    });
  }
  throw new Error("invalid api key");
}

export async function parsePostHogBody(c: Context): Promise<Record<string, unknown>> {
  const contentType = c.req.header("Content-Type") ?? "";
  const encoding = (c.req.header("Content-Encoding") ?? "").toLowerCase();
  let raw = Buffer.from(await c.req.arrayBuffer());

  if (encoding.includes("gzip") || encoding.includes("deflate")) {
    try {
      raw = encoding.includes("deflate") && !encoding.includes("gzip") ? inflateSync(raw) : gunzipSync(raw);
    } catch {
      // fall through with original bytes
    }
  }

  const text = raw.toString("utf8");
  if (!text) return {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(text);
    const result: Record<string, unknown> = {};
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    if (typeof result.data === "string") {
      const decoded = decodeDataPayload(result.data);
      if (decoded) {
        return { ...decoded, api_key: result.api_key ?? decoded.api_key, token: result.token ?? decoded.token };
      }
    }
    return result;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.data === "string" && !obj.event && !obj.batch) {
        const decoded = decodeDataPayload(obj.data);
        if (decoded) {
          return { ...decoded, api_key: obj.api_key ?? decoded.api_key, token: obj.token ?? decoded.token };
        }
      }
      return obj;
    }
    return {};
  } catch {
    return {};
  }
}

export function decodeDataPayload(data: string): Record<string, unknown> | null {
  try {
    let buf = Buffer.from(data, "base64");
    // Some clients send gzip-compressed base64 payloads (magic 1f 8b).
    if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
      buf = gunzipSync(buf);
    }
    const parsed = JSON.parse(buf.toString("utf8")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    try {
      const parsed = JSON.parse(data) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore
    }
    return null;
  }
}

export function extractApiKey(body: Record<string, unknown>, queryToken?: string): string | undefined {
  const candidates = [body.api_key, body.token, queryToken];
  for (const value of candidates) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function matchPropertyFilter(
  filter: PostHogPropertyFilter,
  properties: Record<string, unknown>,
): boolean {
  const key = filter.key;
  const operator = filter.operator ?? "exact";
  const expected = filter.value;
  const hasKey = Object.prototype.hasOwnProperty.call(properties, key);
  const actual = properties[key];

  if (operator === "is_set") return hasKey && actual !== null && actual !== undefined;
  if (operator === "is_not_set") return !hasKey || actual === null || actual === undefined;

  if (!hasKey) return false;
  if (actual === null || actual === undefined) {
    if (operator === "is_not") return true;
    return false;
  }

  switch (operator) {
    case "exact":
      return exactMatch(expected, actual);
    case "is_not":
      return !exactMatch(expected, actual);
    case "icontains":
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case "not_icontains":
      return !String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case "regex":
      try {
        return new RegExp(String(expected)).test(String(actual));
      } catch {
        return false;
      }
    case "not_regex":
      try {
        return !new RegExp(String(expected)).test(String(actual));
      } catch {
        return false;
      }
    default:
      return exactMatch(expected, actual);
  }
}

function exactMatch(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.map((v) => String(v).toLowerCase()).includes(String(actual).toLowerCase());
  }
  return String(expected).toLowerCase() === String(actual).toLowerCase();
}

export function findPersonByDistinctId(
  ps: PostHogStore,
  projectId: number,
  distinctId: string,
): PostHogPerson | undefined {
  return ps.persons
    .all()
    .find((person) => person.project_id === projectId && person.distinct_ids.includes(distinctId));
}

export function upsertPerson(
  ps: PostHogStore,
  projectId: number,
  distinctId: string,
  setProps?: Record<string, unknown>,
  setOnceProps?: Record<string, unknown>,
): PostHogPerson {
  let person = findPersonByDistinctId(ps, projectId, distinctId);
  if (!person) {
    person = ps.persons.insert({
      uuid: generateUuid(),
      project_id: projectId,
      distinct_ids: [distinctId],
      properties: {},
    });
  }

  const properties = { ...person.properties };
  if (setOnceProps) {
    for (const [key, value] of Object.entries(setOnceProps)) {
      if (!(key in properties)) properties[key] = value;
    }
  }
  if (setProps) {
    Object.assign(properties, setProps);
  }

  return ps.persons.update(person.id, { properties })!;
}

export function mergePersons(
  ps: PostHogStore,
  projectId: number,
  distinctId: string,
  alias: string,
): PostHogPerson {
  const primary = upsertPerson(ps, projectId, distinctId);
  const secondary = findPersonByDistinctId(ps, projectId, alias);

  if (!secondary || secondary.id === primary.id) {
    if (!primary.distinct_ids.includes(alias)) {
      return ps.persons.update(primary.id, {
        distinct_ids: [...primary.distinct_ids, alias],
      })!;
    }
    return primary;
  }

  const mergedIds = Array.from(new Set([...primary.distinct_ids, ...secondary.distinct_ids, alias, distinctId]));
  const mergedProps = { ...secondary.properties, ...primary.properties };
  ps.persons.delete(secondary.id);
  return ps.persons.update(primary.id, {
    distinct_ids: mergedIds,
    properties: mergedProps,
  })!;
}

export function paginateResults<T>(
  items: T[],
  limit: number,
  offset: number,
  basePath: string,
  query: Record<string, string | undefined>,
): { count: number; next: string | null; previous: string | null; results: T[] } {
  const count = items.length;
  const sliced = items.slice(offset, offset + limit);
  const makeUrl = (nextOffset: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, value);
    }
    params.set("limit", String(limit));
    params.set("offset", String(nextOffset));
    return `${basePath}?${params.toString()}`;
  };
  return {
    count,
    next: offset + limit < count ? makeUrl(offset + limit) : null,
    previous: offset > 0 ? makeUrl(Math.max(0, offset - limit)) : null,
    results: sliced,
  };
}

export function parseLimitOffset(c: Context, defaultLimit = 100): { limit: number; offset: number } {
  const limit = Math.min(Math.max(1, Number(c.req.query("limit") ?? defaultLimit) || defaultLimit), 1000);
  const offset = Math.max(0, Number(c.req.query("offset") ?? 0) || 0);
  return { limit, offset };
}

export function formatProject(project: PostHogProject) {
  return {
    id: project.project_id,
    uuid: project.uuid,
    organization: "00000000-0000-0000-0000-000000000000",
    api_token: project.api_key,
    name: project.name,
    completed_snippet_onboarding: true,
    ingested_event: true,
    is_demo: false,
    timezone: "UTC",
    access_control: false,
  };
}

export function formatPerson(person: PostHogPerson) {
  return {
    id: person.id,
    uuid: person.uuid,
    name: (person.properties.email as string | undefined) ?? person.distinct_ids[0] ?? person.uuid,
    distinct_ids: person.distinct_ids,
    properties: person.properties,
    created_at: person.created_at,
    last_seen_at: person.updated_at,
  };
}

export function formatEvent(event: import("./entities.js").PostHogEvent) {
  return {
    id: event.uuid,
    uuid: event.uuid,
    event: event.event,
    distinct_id: event.distinct_id,
    properties: event.properties,
    timestamp: event.timestamp,
    person: null,
    elements: [],
    elements_chain: "",
  };
}

export function formatFeatureFlag(flag: import("./entities.js").PostHogFeatureFlag) {
  return {
    id: flag.flag_id,
    name: flag.name,
    key: flag.key,
    filters: flag.filters,
    deleted: flag.deleted,
    active: flag.active,
    created_at: flag.created_at,
    updated_at: flag.updated_at,
    ensure_experience_continuity: flag.ensure_experience_continuity,
    experiment_set: [] as number[],
    rollout_percentage: flag.rollout_percentage,
    version: flag.version,
  };
}

export function nextFlagId(ps: PostHogStore): number {
  const max = ps.featureFlags.all().reduce((acc, flag) => Math.max(acc, flag.flag_id), 0);
  return max + 1;
}

export function nextAnnotationId(ps: PostHogStore): number {
  const max = ps.annotations.all().reduce((acc, item) => Math.max(acc, item.annotation_id), 0);
  return max + 1;
}

export function nextProjectId(ps: PostHogStore): number {
  const max = ps.projects.all().reduce((acc, item) => Math.max(acc, item.project_id), 0);
  return max + 1;
}
