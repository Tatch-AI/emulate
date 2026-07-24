import { beforeEach, describe, expect, it } from "vitest";
import { seedFromConfig } from "../index.js";
import { apiHeaders, base, createTestApp, readJson, type AnthropicTestApp } from "./helpers.js";

describe("Anthropic models", () => {
  let app: AnthropicTestApp["app"];
  let store: AnthropicTestApp["store"];

  beforeEach(() => {
    ({ app, store } = createTestApp());
  });

  it("lists default models with pagination fields", async () => {
    const res = await app.request(`${base}/v1/models`, { headers: apiHeaders() });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.first_id).toBe(body.data[0].id);
    expect(body.last_id).toBe(body.data[body.data.length - 1].id);
    expect(typeof body.has_more).toBe("boolean");
    expect(body.data.every((m: any) => m.type === "model")).toBe(true);
    const ids = body.data.map((m: any) => m.id);
    expect(ids).toContain("claude-sonnet-4-5");
    expect(ids).toContain("claude-opus-4-1");
    expect(ids).not.toContain("claude-3-5-haiku-20241022");
  });

  it("paginates with after_id and limit", async () => {
    const all = await readJson(await app.request(`${base}/v1/models`, { headers: apiHeaders() }));
    const firstId = all.data[0].id;
    const page = await readJson(await app.request(`${base}/v1/models?after_id=${encodeURIComponent(firstId)}&limit=2`, {
        headers: apiHeaders(),
      }));
    expect(page.data.length).toBeLessThanOrEqual(2);
    expect(page.data[0]?.id).not.toBe(firstId);
  });

  it("retrieves a model by id", async () => {
    const res = await app.request(`${base}/v1/models/claude-sonnet-4-5`, { headers: apiHeaders() });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toMatchObject({
      id: "claude-sonnet-4-5",
      type: "model",
      display_name: expect.any(String),
      created_at: expect.any(String),
    });
  });

  it("resolves aliases on retrieve", async () => {
    const res = await app.request(`${base}/v1/models/claude-3-5-haiku-20241022`, { headers: apiHeaders() });
    expect(res.status).toBe(200);
    expect((await readJson(res)).id).toBe("claude-3-5-haiku-latest");
  });

  it("returns 404 for unknown models", async () => {
    const res = await app.request(`${base}/v1/models/not-a-model`, { headers: apiHeaders() });
    expect(res.status).toBe(404);
    expect((await readJson(res)).error.type).toBe("not_found_error");
  });

  it("seeds additional models idempotently", async () => {
    seedFromConfig(store, base, {
      models: [{ id: "claude-custom-1", display_name: "Custom" }],
    });
    seedFromConfig(store, base, {
      models: [{ id: "claude-custom-1", display_name: "Custom Again" }],
    });
    const res = await app.request(`${base}/v1/models/claude-custom-1`, { headers: apiHeaders() });
    expect(res.status).toBe(200);
    expect((await readJson(res)).display_name).toBe("Custom");
  });
});
