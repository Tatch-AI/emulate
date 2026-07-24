import { beforeEach, describe, expect, it } from "vitest";
import { getAnthropicStore, seedFromConfig } from "../index.js";
import { apiHeaders, base, bearerHeaders, createTestApp, parseSse, readJson, type AnthropicTestApp } from "./helpers.js";

describe("Anthropic auth and headers", () => {
  let app: AnthropicTestApp["app"];
  let store: AnthropicTestApp["store"];

  beforeEach(() => {
    ({ app, store } = createTestApp());
  });

  it("returns 400 when anthropic-version is missing", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: { "x-api-key": "sk-test", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.type).toBe("error");
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain("anthropic-version");
    expect(res.headers.get("request-id")).toBeTruthy();
  });

  it("returns 401 authentication_error without api key", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: { "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body).toMatchObject({
      type: "error",
      error: { type: "authentication_error" },
    });
  });

  it("accepts Authorization Bearer as a fallback", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: bearerHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 32,
        messages: [{ role: "user", content: "hello" }],
      }),
    });
    expect(res.status).toBe(200);
  });

  it("rejects unknown keys when api_keys are seeded", async () => {
    seedFromConfig(store, base, { api_keys: ["sk-allowed"] });
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders({ "x-api-key": "sk-wrong" }),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(401);
    expect((await readJson(res)).error.type).toBe("authentication_error");
  });

  it("accepts seeded api keys", async () => {
    seedFromConfig(store, base, { api_keys: [{ key: "sk-allowed", name: "ci" }] });
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders({ "x-api-key": "sk-allowed" }),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(200);
  });
});

describe("Anthropic messages", () => {
  let app: AnthropicTestApp["app"];
  let store: AnthropicTestApp["store"];

  beforeEach(() => {
    ({ app, store } = createTestApp());
  });

  it("creates a message with required fields", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("request-id")).toBeTruthy();
    const body = await readJson(res);
    expect(body.type).toBe("message");
    expect(body.role).toBe("assistant");
    expect(body.id).toMatch(/^msg_[a-zA-Z0-9]{24}$/);
    expect(body.model).toBe("claude-sonnet-4-5");
    expect(body.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("ping") });
    expect(body.stop_reason).toBe("end_turn");
    expect(body.usage.input_tokens).toBeGreaterThan(0);
    expect(body.usage.output_tokens).toBeGreaterThan(0);
    expect(body.usage.cache_creation_input_tokens).toBe(0);
    expect(body.usage.cache_read_input_tokens).toBe(0);
  });

  it("validates missing max_tokens, model, and messages", async () => {
    for (const body of [
      { model: "claude-sonnet-4-5", messages: [{ role: "user", content: "x" }] },
      { max_tokens: 10, messages: [{ role: "user", content: "x" }] },
      { model: "claude-sonnet-4-5", max_tokens: 10 },
    ]) {
      const res = await app.request(`${base}/v1/messages`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      expect((await readJson(res)).error.type).toBe("invalid_request_error");
    }
  });

  it("returns 404 not_found_error for unknown models", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-does-not-exist",
        max_tokens: 16,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error.type).toBe("not_found_error");
    expect(body.error.message).toBe("model: claude-does-not-exist");
  });

  it("requires the first message to be user and alternating roles", async () => {
    const first = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [{ role: "assistant", content: "nope" }],
      }),
    });
    expect(first.status).toBe(400);
    expect((await readJson(first)).error.message).toContain("user");

    const alt = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [
          { role: "user", content: "a" },
          { role: "user", content: "b" },
        ],
      }),
    });
    expect(alt.status).toBe(400);
    expect((await readJson(alt)).error.message).toContain("alternate");
  });

  it("honors system prompts via response matchers", async () => {
    seedFromConfig(store, base, {
      responses: [{ match: { content_contains: "secret-code" }, reply: "SYSTEM-OK" }],
    });
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 32,
        system: "You know secret-code",
        messages: [{ role: "user", content: "say the code secret-code please" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.content[0].text).toBe("SYSTEM-OK");
  });

  it("honors stop_sequences", async () => {
    seedFromConfig(store, base, {
      responses: [{ match: { content_contains: "STOPTEST" }, reply: "hello STOPHERE world" }],
    });
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        stop_sequences: ["STOPHERE"],
        messages: [{ role: "user", content: "STOPTEST" }],
      }),
    });
    const body = await readJson(res);
    expect(body.stop_reason).toBe("stop_sequence");
    expect(body.stop_sequence).toBe("STOPHERE");
    expect(body.content[0].text).toBe("hello ");
  });

  it("honors max_tokens truncation", async () => {
    seedFromConfig(store, base, {
      responses: [{ match: { content_contains: "LONG" }, reply: "abcdefghijABCDEFGHIJabcdefghij" }],
    });
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 2,
        messages: [{ role: "user", content: "LONG" }],
      }),
    });
    const body = await readJson(res);
    expect(body.stop_reason).toBe("max_tokens");
    expect(body.content[0].text.length).toBeLessThanOrEqual(8);
  });

  it("returns tool_use when matcher or tool_choice directs it", async () => {
    seedFromConfig(store, base, {
      responses: [
        {
          match: { content_contains: "weather" },
          tool_call: { name: "get_weather", input: { city: "SF" } },
        },
      ],
    });
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        tools: [
          {
            name: "get_weather",
            description: "Weather",
            input_schema: { type: "object", properties: { city: { type: "string" } } },
          },
        ],
        messages: [{ role: "user", content: "What is the weather in SF?" }],
      }),
    });
    const body = await readJson(res);
    expect(body.stop_reason).toBe("tool_use");
    expect(body.content[0]).toMatchObject({
      type: "tool_use",
      name: "get_weather",
      input: { city: "SF" },
    });
    expect(body.content[0].id).toMatch(/^toolu_[a-zA-Z0-9]{24}$/);
  });

  it("supports tool_result round trip", async () => {
    seedFromConfig(store, base, {
      responses: [
        {
          match: { content_contains: "weather" },
          tool_call: { name: "get_weather", input: { city: "SF" } },
        },
        {
          match: { content_contains: "72F" },
          reply: "It is 72F in SF.",
        },
      ],
    });

    const first = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        tools: [
          {
            name: "get_weather",
            description: "Weather",
            input_schema: { type: "object", properties: { city: { type: "string" } } },
          },
        ],
        messages: [{ role: "user", content: "weather please" }],
      }),
    });
    const toolMsg = await readJson(first);
    const toolUse = toolMsg.content[0];

    const second = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        tools: [
          {
            name: "get_weather",
            description: "Weather",
            input_schema: { type: "object", properties: { city: { type: "string" } } },
          },
        ],
        messages: [
          { role: "user", content: "weather please" },
          { role: "assistant", content: [toolUse] },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: toolUse.id, content: "72F and sunny" }],
          },
        ],
      }),
    });
    expect(second.status).toBe(200);
    const reply = await readJson(second);
    expect(reply.content[0].text).toBe("It is 72F in SF.");
  });

  it("prepends thinking blocks when enabled", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        thinking: { type: "enabled", budget_tokens: 1024 },
        messages: [{ role: "user", content: "think hard" }],
      }),
    });
    const body = await readJson(res);
    expect(body.content[0].type).toBe("thinking");
    expect(body.content[0].thinking).toBeTruthy();
    expect(body.content[0].signature).toBeTruthy();
    expect(body.content[1].type).toBe("text");
  });

  it("streams SSE events for text responses", async () => {
    seedFromConfig(store, base, {
      responses: [{ match: { content_contains: "stream-me" }, reply: "abcdef" }],
    });
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "stream-me" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    const events = parseSse(text);
    expect(events.map((e) => e.event)).toEqual([
      "message_start",
      "content_block_start",
      "ping",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    const deltas = events
      .filter((e) => e.event === "content_block_delta")
      .map((e) => (e.data as any).delta.text)
      .join("");
    expect(deltas).toBe("abcdef");
    expect((events[0]!.data as any).message.usage.input_tokens).toBeGreaterThan(0);
    expect((events.find((e) => e.event === "message_delta")!.data as any).delta.stop_reason).toBe("end_turn");
  });

  it("streams tool_use with input_json_delta", async () => {
    seedFromConfig(store, base, {
      responses: [{ match: { content_contains: "toolstream" }, tool_call: { name: "echo", input: { v: 1 } } }],
    });
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        stream: true,
        tools: [{ name: "echo", description: "echo", input_schema: { type: "object" } }],
        messages: [{ role: "user", content: "toolstream" }],
      }),
    });
    const events = parseSse(await res.text());
    expect(events.some((e) => e.event === "ping")).toBe(true);
    const start = events.find((e) => e.event === "content_block_start")!.data as any;
    expect(start.content_block.type).toBe("tool_use");
    const partial = events
      .filter((e) => e.event === "content_block_delta")
      .map((e) => (e.data as any).delta.partial_json)
      .join("");
    expect(JSON.parse(partial)).toEqual({ v: 1 });
  });

  it("counts tokens", async () => {
    const res = await app.request(`${base}/v1/messages/count_tokens`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "hello tokens" }],
        system: "be brief",
      }),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.input_tokens).toBeGreaterThan(0);
  });

  it("records request logs for messages and count_tokens", async () => {
    await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "log me" }],
      }),
    });
    await app.request(`${base}/v1/messages/count_tokens`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        messages: [{ role: "user", content: "count me" }],
      }),
    });
    const logs = getAnthropicStore(store).requestLogs.all();
    expect(logs.some((l) => l.kind === "messages")).toBe(true);
    expect(logs.some((l) => l.kind === "count_tokens")).toBe(true);
  });

  it("resolves model aliases in requests", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 16,
        messages: [{ role: "user", content: "alias" }],
      }),
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).model).toBe("claude-3-5-haiku-latest");
  });

  it("uses tool_choice type any", async () => {
    const res = await app.request(`${base}/v1/messages`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 32,
        tool_choice: { type: "any" },
        tools: [{ name: "lookup", description: "lookup", input_schema: { type: "object" } }],
        messages: [{ role: "user", content: "do it" }],
      }),
    });
    const body = await readJson(res);
    expect(body.stop_reason).toBe("tool_use");
    expect(body.content[0].name).toBe("lookup");
  });
});
