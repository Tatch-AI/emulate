import { beforeEach, describe, expect, it } from "vitest";
import { posthogHash } from "../helpers.js";
import {
  DEFAULT_PROJECT_API_KEY,
  base,
  createPostHogTestApp,
  jsonHeaders,
  type PostHogTestApp,
} from "./helpers.js";

function findDistinctIdsForRollout(flagKey: string, percentage: number): { inside: string; outside: string } {
  let inside: string | undefined;
  let outside: string | undefined;
  for (let i = 0; i < 10_000; i++) {
    const id = `user-${i}`;
    const hash = posthogHash(flagKey, id);
    if (!inside && hash <= percentage / 100) inside = id;
    if (!outside && hash > percentage / 100) outside = id;
    if (inside && outside) return { inside, outside };
  }
  throw new Error("Could not find distinct ids on both sides of rollout");
}

describe("PostHog decide and flags", () => {
  let setup: PostHogTestApp;

  beforeEach(() => {
    setup = createPostHogTestApp({
      project: { api_key: DEFAULT_PROJECT_API_KEY },
      personal_api_keys: ["phx_test_personal"],
      feature_flags: [
        {
          key: "always-on",
          active: true,
          filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
        },
        {
          key: "always-off",
          active: false,
          filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
        },
        {
          key: "half-rollout",
          active: true,
          filters: { groups: [{ properties: [], rollout_percentage: 50 }] },
        },
        {
          key: "email-filter",
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: "email", operator: "icontains", value: "@example.com" }],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          key: "exact-plan",
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: "plan", operator: "exact", value: "pro" }],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          key: "not-guest",
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: "role", operator: "is_not", value: "guest" }],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          key: "has-email",
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: "email", operator: "is_set", value: "" }],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          key: "regex-domain",
          active: true,
          filters: {
            groups: [
              {
                properties: [{ key: "email", operator: "regex", value: ".*@acme\\.io$" }],
                rollout_percentage: 100,
              },
            ],
          },
        },
        {
          key: "multivariate-test",
          active: true,
          filters: {
            groups: [{ properties: [], rollout_percentage: 100 }],
            multivariate: {
              variants: [
                { key: "control", rollout_percentage: 50 },
                { key: "test", rollout_percentage: 50 },
              ],
            },
            payloads: {
              control: { copy: "A" },
              test: { copy: "B" },
            },
          },
        },
      ],
      persons: [
        {
          distinct_ids: ["person-pro"],
          properties: { email: "pro@example.com", plan: "pro", role: "admin" },
        },
      ],
    });
  });

  it("evaluates decide v=3 boolean flags", async () => {
    const res = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        distinct_id: "anyone",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      featureFlags: Record<string, boolean | string>;
      errorsWhileComputingFlags: boolean;
      config: { enable_collect_everything: boolean };
    };
    expect(body.config.enable_collect_everything).toBe(true);
    expect(body.errorsWhileComputingFlags).toBe(false);
    expect(body.featureFlags["always-on"]).toBe(true);
    expect(body.featureFlags["always-off"]).toBeUndefined();
  });

  it("evaluates decide v=4 shape", async () => {
    const res = await setup.app.request(`${base}/decide/?v=4`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        distinct_id: "anyone",
      }),
    });
    const body = (await res.json()) as {
      flags: Record<string, { key: string; enabled: boolean; metadata: { id: number } }>;
    };
    expect(body.flags["always-on"].enabled).toBe(true);
    expect(body.flags["always-on"].key).toBe("always-on");
    expect(body.flags["always-on"].metadata.id).toBeGreaterThan(0);
  });

  it("is deterministic for rollout percentage and covers both sides", async () => {
    const { inside, outside } = findDistinctIdsForRollout("half-rollout", 50);

    const insideRes = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ api_key: DEFAULT_PROJECT_API_KEY, distinct_id: inside }),
    });
    const outsideRes = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ api_key: DEFAULT_PROJECT_API_KEY, distinct_id: outside }),
    });
    const insideBody = (await insideRes.json()) as { featureFlags: Record<string, boolean> };
    const outsideBody = (await outsideRes.json()) as { featureFlags: Record<string, boolean> };
    expect(insideBody.featureFlags["half-rollout"]).toBe(true);
    expect(outsideBody.featureFlags["half-rollout"]).toBe(false);

    const again = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ api_key: DEFAULT_PROJECT_API_KEY, distinct_id: inside }),
    });
    expect(((await again.json()) as { featureFlags: Record<string, boolean> }).featureFlags["half-rollout"]).toBe(
      true,
    );
  });

  it("applies person property filters", async () => {
    const matching = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        distinct_id: "person-pro",
      }),
    });
    const matchingBody = (await matching.json()) as { featureFlags: Record<string, boolean> };
    expect(matchingBody.featureFlags["email-filter"]).toBe(true);
    expect(matchingBody.featureFlags["exact-plan"]).toBe(true);
    expect(matchingBody.featureFlags["not-guest"]).toBe(true);
    expect(matchingBody.featureFlags["has-email"]).toBe(true);

    const override = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        distinct_id: "unknown",
        person_properties: { email: "dev@acme.io", role: "guest" },
      }),
    });
    const overrideBody = (await override.json()) as { featureFlags: Record<string, boolean> };
    expect(overrideBody.featureFlags["regex-domain"]).toBe(true);
    expect(overrideBody.featureFlags["email-filter"]).toBe(false);
    expect(overrideBody.featureFlags["not-guest"]).toBe(false);
  });

  it("assigns multivariate variants and payloads", async () => {
    const res = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        distinct_id: "variant-user",
      }),
    });
    const body = (await res.json()) as {
      featureFlags: Record<string, string | boolean>;
      featureFlagPayloads: Record<string, { copy: string }>;
    };
    expect(["control", "test"]).toContain(body.featureFlags["multivariate-test"]);
    const variant = body.featureFlags["multivariate-test"] as string;
    expect(body.featureFlagPayloads["multivariate-test"].copy).toBe(variant === "control" ? "A" : "B");

    const again = await setup.app.request(`${base}/decide/?v=3`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        distinct_id: "variant-user",
      }),
    });
    expect(((await again.json()) as typeof body).featureFlags["multivariate-test"]).toBe(variant);
  });

  it("evaluates /flags/?v=2 like decide v4", async () => {
    const res = await setup.app.request(`${base}/flags/?v=2`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        token: DEFAULT_PROJECT_API_KEY,
        distinct_id: "anyone",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flags: Record<string, { enabled: boolean }> };
    expect(body.flags["always-on"].enabled).toBe(true);
  });
});
