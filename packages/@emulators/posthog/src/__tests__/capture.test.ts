import { beforeEach, describe, expect, it } from "vitest";
import { posthogHash } from "../helpers.js";
import {
  DEFAULT_PROJECT_API_KEY,
  base,
  createPostHogTestApp,
  getPostHogStore,
  jsonHeaders,
  type PostHogTestApp,
} from "./helpers.js";

describe("PostHog capture", () => {
  let setup: PostHogTestApp;

  beforeEach(() => {
    setup = createPostHogTestApp();
  });

  it("captures a single event via /capture/", async () => {
    const res = await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "signed_up",
        distinct_id: "user-1",
        properties: { plan: "pro" },
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 1 });

    const events = getPostHogStore(setup.store).events.all();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: "signed_up",
      distinct_id: "user-1",
      properties: { plan: "pro" },
    });
  });

  it("accepts alias endpoints without trailing slash", async () => {
    for (const path of ["/capture", "/batch", "/e"]) {
      const res = await setup.app.request(`${base}${path}`, {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify({
          api_key: DEFAULT_PROJECT_API_KEY,
          event: `evt${path}`,
          distinct_id: "alias-user",
        }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 1 });
    }
  });

  it("captures batch events", async () => {
    const res = await setup.app.request(`${base}/batch/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        batch: [
          { event: "a", distinct_id: "u1" },
          { event: "b", distinct_id: "u2" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(getPostHogStore(setup.store).events.count()).toBe(2);
  });

  it("captures base64 data payloads", async () => {
    const payload = {
      api_key: DEFAULT_PROJECT_API_KEY,
      event: "encoded",
      distinct_id: "u-encoded",
      properties: { ok: true },
    };
    const data = Buffer.from(JSON.stringify(payload)).toString("base64");
    const res = await setup.app.request(`${base}/e/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({ api_key: DEFAULT_PROJECT_API_KEY, data }),
    });
    expect(res.status).toBe(200);
    expect(getPostHogStore(setup.store).events.findOneBy("event", "encoded")?.distinct_id).toBe("u-encoded");
  });

  it("captures form-encoded data payloads", async () => {
    const payload = {
      api_key: DEFAULT_PROJECT_API_KEY,
      event: "form_event",
      distinct_id: "form-user",
    };
    const data = Buffer.from(JSON.stringify(payload)).toString("base64");
    const body = new URLSearchParams({ api_key: DEFAULT_PROJECT_API_KEY, data });
    const res = await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(res.status).toBe(200);
    expect(getPostHogStore(setup.store).events.findOneBy("event", "form_event")).toBeTruthy();
  });

  it("returns Ok for /i/v0/e/", async () => {
    const res = await setup.app.request(`${base}/i/v0/e/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "modern",
        distinct_id: "u-modern",
      }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "Ok" });
  });

  it("rejects invalid project api keys when keys are seeded", async () => {
    const res = await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: "phc_wrong",
        event: "nope",
        distinct_id: "u",
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { type: string; code: string };
    expect(body.type).toBe("authentication_error");
    expect(body.code).toBe("invalid_api_key");
  });

  it("accepts any phc_ key when no project keys are seeded", async () => {
    const empty = createPostHogTestApp({ project: { api_key: "phc_will_be_cleared" } });
    getPostHogStore(empty.store).projects.clear();
    getPostHogStore(empty.store).personalApiKeys.clear();
    getPostHogStore(empty.store).featureFlags.clear();

    const res = await empty.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: "phc_ephemeral_any",
        event: "free",
        distinct_id: "anon",
      }),
    });
    expect(res.status).toBe(200);
    expect(getPostHogStore(empty.store).events.count()).toBe(1);
  });

  it("creates persons on $identify and merges $set properties", async () => {
    await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "$identify",
        distinct_id: "user@example.com",
        properties: {
          $set: { email: "user@example.com", plan: "free" },
          $set_once: { first_seen: "today" },
        },
      }),
    });

    await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "pageview",
        distinct_id: "user@example.com",
        properties: {
          $set: { plan: "pro" },
          $set_once: { first_seen: "should-not-overwrite" },
        },
      }),
    });

    const person = getPostHogStore(setup.store).persons.all()[0];
    expect(person.distinct_ids).toContain("user@example.com");
    expect(person.properties).toMatchObject({
      email: "user@example.com",
      plan: "pro",
      first_seen: "today",
    });
  });

  it("links aliases with $create_alias", async () => {
    await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "$identify",
        distinct_id: "identified",
        properties: { $set: { role: "admin" } },
      }),
    });
    await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "$create_alias",
        distinct_id: "identified",
        properties: { alias: "anon-123" },
      }),
    });

    const persons = getPostHogStore(setup.store).persons.all();
    expect(persons).toHaveLength(1);
    expect(persons[0].distinct_ids.sort()).toEqual(["anon-123", "identified"]);
    expect(persons[0].properties.role).toBe("admin");
  });

  it("links with $merge_dangerously", async () => {
    await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "a",
        distinct_id: "left",
        properties: { $set: { from: "left" } },
      }),
    });
    await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "b",
        distinct_id: "right",
        properties: { $set: { from: "right", extra: true } },
      }),
    });
    await setup.app.request(`${base}/capture/`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify({
        api_key: DEFAULT_PROJECT_API_KEY,
        event: "$merge_dangerously",
        distinct_id: "left",
        properties: { alias: "right" },
      }),
    });

    const persons = getPostHogStore(setup.store).persons.all();
    expect(persons).toHaveLength(1);
    expect(persons[0].distinct_ids.sort()).toEqual(["left", "right"]);
    expect(persons[0].properties).toMatchObject({ from: "left", extra: true });
  });

  it("exposes the same hash function PostHog uses for rollouts", () => {
    const value = posthogHash("flag", "user-1");
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
    expect(posthogHash("flag", "user-1")).toBe(value);
  });
});
