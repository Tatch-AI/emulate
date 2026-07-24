import { beforeEach, describe, expect, it } from "vitest";
import { seedFromConfig } from "../index.js";
import { apiHeaders, base, createTestApp, type AnthropicTestApp } from "./helpers.js";

describe("Anthropic inspector", () => {
  let app: AnthropicTestApp["app"];
  let store: AnthropicTestApp["store"];

  beforeEach(() => {
    ({ app, store } = createTestApp());
  });

  it("renders request log, models, batches, and keys tabs", async () => {
    await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "inspector prompt" }],
      }),
    });
    await app.request(`${base}/v1/messages/batches`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        requests: [
          {
            custom_id: "i1",
            params: {
              model: "claude-sonnet-4-5",
              max_tokens: 8,
              messages: [{ role: "user", content: "b" }],
            },
          },
        ],
      }),
    });
    seedFromConfig(store, base, { api_keys: ["sk-inspector"] });

    const requests = await app.request(`${base}/?tab=requests`);
    expect(requests.status).toBe(200);
    const requestsHtml = await requests.text();
    expect(requestsHtml).toContain("Message Request Log");
    expect(requestsHtml).toContain("inspector prompt");
    expect(requestsHtml).toContain("inspector-table");

    const models = await (await app.request(`${base}/?tab=models`)).text();
    expect(models).toContain("claude-sonnet-4-5");

    const batches = await (await app.request(`${base}/?tab=batches`)).text();
    expect(batches).toContain("msgbatch_");

    const keys = await (await app.request(`${base}/?tab=keys`)).text();
    expect(keys).toContain("API Keys");
    expect(keys).toContain("sk-ins");
  });
});
