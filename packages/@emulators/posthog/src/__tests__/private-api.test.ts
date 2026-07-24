import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONAL_API_KEY,
  DEFAULT_PROJECT_API_KEY,
  base,
  createPostHogTestApp,
  jsonHeaders,
  personalAuthHeaders,
  type PostHogTestApp,
} from "./helpers.js";

describe("PostHog private API", () => {
  let setup: PostHogTestApp;

  beforeEach(() => {
    setup = createPostHogTestApp({
      project: { id: 1, name: "Default project", api_key: DEFAULT_PROJECT_API_KEY },
      personal_api_keys: [DEFAULT_PERSONAL_API_KEY],
      feature_flags: [
        {
          key: "seeded-flag",
          active: true,
          filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
        },
      ],
      persons: [{ distinct_ids: ["seeded-user"], properties: { plan: "free" } }],
    });
  });

  it("requires personal API key auth", async () => {
    const res = await setup.app.request(`${base}/api/projects/@current/`);
    expect(res.status).toBe(401);

    const bad = await setup.app.request(`${base}/api/projects/@current/`, {
      headers: { Authorization: "Bearer phx_wrong" },
    });
    expect(bad.status).toBe(401);
  });

  it("returns project info", async () => {
    const current = await setup.app.request(`${base}/api/projects/@current/`, {
      headers: personalAuthHeaders(),
    });
    expect(current.status).toBe(200);
    const body = (await current.json()) as { id: number; name: string; api_token: string };
    expect(body.id).toBe(1);
    expect(body.name).toBe("Default project");
    expect(body.api_token).toBe(DEFAULT_PROJECT_API_KEY);

    const byId = await setup.app.request(`${base}/api/projects/1/`, {
      headers: personalAuthHeaders(),
    });
    expect(byId.status).toBe(200);
    expect(((await byId.json()) as { id: number }).id).toBe(1);
  });

  it("lists and creates feature flags that become live in /decide", async () => {
    const list = await setup.app.request(`${base}/api/projects/1/feature_flags/`, {
      headers: personalAuthHeaders(),
    });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { count: number; results: Array<{ key: string }> };
    expect(listed.count).toBeGreaterThanOrEqual(1);
    expect(listed.results.some((flag) => flag.key === "seeded-flag")).toBe(true);

    const created = await setup.app.request(`${base}/api/projects/1/feature_flags/`, {
      method: "POST",
      headers: personalAuthHeaders(),
      body: JSON.stringify({
        key: "api-created",
        name: "API created",
        active: true,
        filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
      }),
    });
    expect(created.status).toBe(201);
    const flag = (await created.json()) as { id: number; key: string };
    expect(flag.key).toBe("api-created");

    const decide = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ api_key: DEFAULT_PROJECT_API_KEY, distinct_id: "live-check" }),
    });
    const decideBody = (await decide.json()) as { featureFlags: Record<string, boolean> };
    expect(decideBody.featureFlags["api-created"]).toBe(true);

    const patched = await setup.app.request(`${base}/api/projects/1/feature_flags/${flag.id}/`, {
      method: "PATCH",
      headers: personalAuthHeaders(),
      body: JSON.stringify({ active: false }),
    });
    expect(patched.status).toBe(200);

    const decideOff = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ api_key: DEFAULT_PROJECT_API_KEY, distinct_id: "live-check" }),
    });
    expect(((await decideOff.json()) as typeof decideBody).featureFlags["api-created"]).toBeUndefined();

    const deleted = await setup.app.request(`${base}/api/projects/1/feature_flags/${flag.id}/`, {
      method: "DELETE",
      headers: personalAuthHeaders(),
    });
    expect(deleted.status).toBe(200);
  });

  it("queries persons with filters and pagination", async () => {
    await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "$identify",
        distinct_id: "page-user-2",
        properties: { $set: { email: "two@example.com" } },
      }),
    });

    const byDistinct = await setup.app.request(
      `${base}/api/projects/1/persons/?distinct_id=seeded-user`,
      { headers: personalAuthHeaders() },
    );
    const distinctBody = (await byDistinct.json()) as { count: number; results: Array<{ distinct_ids: string[] }> };
    expect(distinctBody.count).toBe(1);
    expect(distinctBody.results[0].distinct_ids).toContain("seeded-user");

    const page = await setup.app.request(`${base}/api/projects/1/persons/?limit=1&offset=0`, {
      headers: personalAuthHeaders(),
    });
    const pageBody = (await page.json()) as { count: number; next: string | null; results: unknown[] };
    expect(pageBody.results).toHaveLength(1);
    expect(pageBody.count).toBeGreaterThanOrEqual(2);
    expect(pageBody.next).toContain("offset=1");

    const one = await setup.app.request(`${base}/api/projects/1/persons/seeded-user/`, {
      headers: personalAuthHeaders(),
    });
    expect(one.status).toBe(200);
  });

  it("queries events with filters and pagination", async () => {
    await setup.app.request(`${base}/batch/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        batch: [
          { event: "purchase", distinct_id: "buyer", timestamp: "2026-01-02T00:00:00.000Z" },
          { event: "login", distinct_id: "buyer", timestamp: "2026-01-01T00:00:00.000Z" },
          { event: "purchase", distinct_id: "other", timestamp: "2026-01-03T00:00:00.000Z" },
        ],
      }),
    });

    const filtered = await setup.app.request(
      `${base}/api/projects/1/events/?event=purchase&distinct_id=buyer`,
      { headers: personalAuthHeaders() },
    );
    const filteredBody = (await filtered.json()) as { count: number; results: Array<{ event: string }> };
    expect(filteredBody.count).toBe(1);
    expect(filteredBody.results[0].event).toBe("purchase");

    const ranged = await setup.app.request(
      `${base}/api/projects/1/events/?after=2026-01-01T12:00:00.000Z&before=2026-01-03T00:00:00.000Z`,
      { headers: personalAuthHeaders() },
    );
    const rangedBody = (await ranged.json()) as { count: number };
    expect(rangedBody.count).toBe(1);

    const page = await setup.app.request(`${base}/api/projects/1/events/?limit=1&offset=0`, {
      headers: personalAuthHeaders(),
    });
    const pageBody = (await page.json()) as { next: string | null; results: unknown[] };
    expect(pageBody.results).toHaveLength(1);
    expect(pageBody.next).toContain("offset=1");
  });

  it("creates and lists annotations", async () => {
    const created = await setup.app.request(`${base}/api/projects/1/annotations/`, {
      method: "POST",
      headers: personalAuthHeaders(),
      body: JSON.stringify({ content: "Release day", date_marker: "2026-07-23T00:00:00.000Z" }),
    });
    expect(created.status).toBe(201);

    const listed = await setup.app.request(`${base}/api/projects/1/annotations/`, {
      headers: personalAuthHeaders(),
    });
    const body = (await listed.json()) as { count: number; results: Array<{ content: string }> };
    expect(body.count).toBe(1);
    expect(body.results[0].content).toBe("Release day");
  });

  it("returns local evaluation definitions", async () => {
    const res = await setup.app.request(
      `${base}/api/feature_flag/local_evaluation?token=${DEFAULT_PROJECT_API_KEY}&send_cohorts`,
      { headers: personalAuthHeaders() },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      flags: Array<{ key: string; filters: unknown }>;
      group_type_mapping: Record<string, string>;
      cohorts: Record<string, unknown>;
    };
    expect(body.flags.some((flag) => flag.key === "seeded-flag")).toBe(true);
    expect(body.group_type_mapping).toEqual({});
    expect(body.cohorts).toEqual({});

    const defs = await setup.app.request(
      `${base}/flags/definitions?token=${DEFAULT_PROJECT_API_KEY}&send_cohorts`,
      { headers: personalAuthHeaders() },
    );
    expect(defs.status).toBe(200);
    expect(((await defs.json()) as typeof body).flags.length).toBeGreaterThan(0);
  });

  it("renders the inspector", async () => {
    const res = await setup.app.request(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("PostHog Inspector");
    expect(html).toContain("Events");
    expect(html).toContain("Feature flags");
  });
});
