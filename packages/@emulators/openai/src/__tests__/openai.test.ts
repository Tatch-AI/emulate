import { describe, it, expect, beforeEach } from "vitest";
import type { Hono } from "@emulators/core";
import { seedFromConfig, getOpenAIStore } from "../index.js";
import {
  authHeaders,
  createOpenAITestApp,
  openaiTestBaseUrl as base,
  openaiTestKey,
  parseSseDataLines,
  parseSseEvents,
} from "./helpers.js";

describe("OpenAI plugin - auth and errors", () => {
  let app: Hono;

  beforeEach(() => {
    app = createOpenAITestApp().app;
  });

  it("returns 401 with OpenAI error envelope when Authorization is missing", async () => {
    const res = await app.request(`${base}/v1/models`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.code).toBe("invalid_api_key");
    expect(body.error.param).toBeNull();
    expect(typeof body.error.message).toBe("string");
  });

  it("accepts any Bearer key when no api_keys are seeded", async () => {
    const res = await app.request(`${base}/v1/models`, {
      headers: { Authorization: "Bearer sk-anything" },
    });
    expect(res.status).toBe(200);
  });

  it("rejects unknown keys when api_keys are seeded", async () => {
    const { app: seededApp, store } = createOpenAITestApp();
    seedFromConfig(store, base, { api_keys: ["sk-allowed"] });
    const bad = await seededApp.request(`${base}/v1/models`, {
      headers: { Authorization: "Bearer sk-wrong" },
    });
    expect(bad.status).toBe(401);
    const ok = await seededApp.request(`${base}/v1/models`, {
      headers: { Authorization: "Bearer sk-allowed" },
    });
    expect(ok.status).toBe(200);
  });

  it("echoes organization/project and sets x-request-id", async () => {
    const res = await app.request(`${base}/v1/models`, {
      headers: {
        Authorization: `Bearer ${openaiTestKey}`,
        "OpenAI-Organization": "org_test",
        "OpenAI-Project": "proj_test",
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.headers.get("OpenAI-Organization")).toBe("org_test");
    expect(res.headers.get("OpenAI-Project")).toBe("proj_test");
  });
});

describe("OpenAI plugin - chat completions", () => {
  let app: Hono;

  beforeEach(() => {
    const setup = createOpenAITestApp({
      responses: [
        { match: { content_contains: "ping" }, reply: "pong" },
        {
          match: { content_contains: "call weather" },
          reply: "",
          tool_call: { name: "get_weather", arguments: { city: "SF" } },
        },
      ],
    });
    app = setup.app;
  });

  it("POST /v1/chat/completions returns a completion", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "ping please" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toMatch(/^chatcmpl-/);
    expect(body.object).toBe("chat.completion");
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.choices[0].message.role).toBe("assistant");
    expect(body.choices[0].message.content).toBe("pong");
    expect(body.choices[0].message.refusal).toBeNull();
    expect(body.choices[0].finish_reason).toBe("stop");
    expect(body.usage.prompt_tokens).toBeGreaterThan(0);
    expect(body.usage.completion_tokens).toBeGreaterThan(0);
    expect(body.usage.total_tokens).toBe(body.usage.prompt_tokens + body.usage.completion_tokens);
    expect(body.usage.prompt_tokens_details).toBeDefined();
    expect(body.usage.completion_tokens_details).toBeDefined();
    expect(body.system_fingerprint).toBeTruthy();
  });

  it("validates missing model and messages", async () => {
    const missingModel = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(missingModel.status).toBe(400);
    const modelErr = (await missingModel.json()) as any;
    expect(modelErr.error.type).toBe("invalid_request_error");
    expect(modelErr.error.param).toBe("model");

    const missingMessages = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ model: "gpt-4o-mini" }),
    });
    expect(missingMessages.status).toBe(400);
    const msgErr = (await missingMessages.json()) as any;
    expect(msgErr.error.param).toBe("messages");
  });

  it("returns 404 model_not_found for unknown models", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "does-not-exist",
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("model_not_found");
  });

  it("supports multipart message content arrays", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "ping" },
              { type: "text", text: " again" },
            ],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.choices[0].message.content).toBe("pong");
  });

  it("supports n>1 choices", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        n: 3,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.choices).toHaveLength(3);
    expect(body.choices.map((c: any) => c.index)).toEqual([0, 1, 2]);
  });

  it("returns tool_calls when matcher directs a tool call", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "please call weather" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              parameters: { type: "object", properties: { city: { type: "string" } } },
            },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.content).toBeNull();
    expect(body.choices[0].message.tool_calls[0].id).toMatch(/^call_/);
    expect(body.choices[0].message.tool_calls[0].type).toBe("function");
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
    expect(JSON.parse(body.choices[0].message.tool_calls[0].function.arguments)).toEqual({ city: "SF" });
  });

  it("honors tool_choice function force", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
        tool_choice: { type: "function", function: { name: "lookup" } },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.choices[0].finish_reason).toBe("tool_calls");
    expect(body.choices[0].message.tool_calls[0].function.name).toBe("lookup");
  });

  it("honors response_format json_object", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "say hello" }],
        response_format: { type: "json_object" },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const parsed = JSON.parse(body.choices[0].message.content);
    expect(parsed).toHaveProperty("message");
  });

  it("honors response_format json_schema", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "make an object" }],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "person",
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "integer" },
                active: { type: "boolean" },
              },
              required: ["name", "age", "active"],
            },
          },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const parsed = JSON.parse(body.choices[0].message.content);
    expect(typeof parsed.name).toBe("string");
    expect(typeof parsed.age).toBe("number");
    expect(typeof parsed.active).toBe("boolean");
  });

  it("streams SSE chat.completion.chunk events and [DONE]", async () => {
    const res = await app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        stream_options: { include_usage: true },
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("data: [DONE]");
    const chunks = parseSseDataLines(text) as any[];
    expect(chunks[0].object).toBe("chat.completion.chunk");
    expect(chunks[0].choices[0].delta.role).toBe("assistant");
    const content = chunks
      .map((c) => c.choices?.[0]?.delta?.content ?? "")
      .join("");
    expect(content).toBe("pong");
    const finalWithReason = chunks.find((c) => c.choices?.[0]?.finish_reason === "stop");
    expect(finalWithReason).toBeTruthy();
    const usageChunk = chunks.find((c) => c.usage);
    expect(usageChunk.usage.total_tokens).toBeGreaterThan(0);
  });

  it("records request logs for chat completions", async () => {
    const setup = createOpenAITestApp();
    await setup.app.request(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "hello world" }],
      }),
    });
    const logs = getOpenAIStore(setup.store).requestLogs.all();
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].path).toBe("/v1/chat/completions");
    expect(logs[0].model).toBe("gpt-4o-mini");
  });
});

describe("OpenAI plugin - responses API", () => {
  let app: Hono;

  beforeEach(() => {
    app = createOpenAITestApp({
      responses: [{ match: { content_contains: "alpha" }, reply: "beta" }],
    }).app;
  });

  it("POST /v1/responses creates a stored response", async () => {
    const res = await app.request(`${base}/v1/responses`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o",
        input: "alpha input",
        instructions: "be helpful",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.id).toMatch(/^resp_/);
    expect(body.object).toBe("response");
    expect(body.status).toBe("completed");
    expect(body.output[0].type).toBe("message");
    expect(body.output[0].id).toMatch(/^msg_/);
    expect(body.output[0].content[0].type).toBe("output_text");
    expect(body.output[0].content[0].text).toBe("beta");
    expect(body.usage.input_tokens).toBeGreaterThan(0);
    expect(body.error).toBeNull();
    expect(body.incomplete_details).toBeNull();

    const get = await app.request(`${base}/v1/responses/${body.id}`, { headers: authHeaders() });
    expect(get.status).toBe(200);
    const stored = (await get.json()) as any;
    expect(stored.id).toBe(body.id);

    const del = await app.request(`${base}/v1/responses/${body.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(del.status).toBe(200);
    const deleted = (await del.json()) as any;
    expect(deleted.deleted).toBe(true);
  });

  it("streams response events with event/data pairs", async () => {
    const res = await app.request(`${base}/v1/responses`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o",
        input: "alpha",
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const events = parseSseEvents(text);
    const names = events.map((e) => e.event);
    expect(names).toContain("response.created");
    expect(names).toContain("response.in_progress");
    expect(names).toContain("response.output_item.added");
    expect(names).toContain("response.content_part.added");
    expect(names).toContain("response.output_text.delta");
    expect(names).toContain("response.output_text.done");
    expect(names).toContain("response.content_part.done");
    expect(names).toContain("response.output_item.done");
    expect(names).toContain("response.completed");
    const deltas = events
      .filter((e) => e.event === "response.output_text.delta")
      .map((e) => (e.data as any).delta)
      .join("");
    expect(deltas).toBe("beta");
  });

  it("accepts array input items", async () => {
    const res = await app.request(`${base}/v1/responses`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "gpt-4o",
        input: [{ role: "user", content: [{ type: "input_text", text: "alpha" }] }],
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.output[0].content[0].text).toBe("beta");
  });
});

describe("OpenAI plugin - embeddings", () => {
  let app: Hono;

  beforeEach(() => {
    app = createOpenAITestApp().app;
  });

  it("returns deterministic float embeddings", async () => {
    const make = () =>
      app.request(`${base}/v1/embeddings`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: "identical input",
        }),
      });
    const a = (await (await make()).json()) as any;
    const b = (await (await make()).json()) as any;
    expect(a.object).toBe("list");
    expect(a.data[0].object).toBe("embedding");
    expect(a.data[0].embedding).toHaveLength(1536);
    expect(a.data[0].embedding).toEqual(b.data[0].embedding);
    const norm = Math.sqrt(a.data[0].embedding.reduce((s: number, v: number) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("supports dimensions truncation and base64 encoding", async () => {
    const res = await app.request(`${base}/v1/embeddings`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "text-embedding-3-large",
        input: ["one", "two"],
        dimensions: 8,
        encoding_format: "base64",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(2);
    expect(typeof body.data[0].embedding).toBe("string");
    const buf = Buffer.from(body.data[0].embedding, "base64");
    expect(buf.byteLength).toBe(8 * 4);
  });

  it("defaults large model to 3072 dims", async () => {
    const res = await app.request(`${base}/v1/embeddings`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "text-embedding-3-large",
        input: "dims",
      }),
    });
    const body = (await res.json()) as any;
    expect(body.data[0].embedding).toHaveLength(3072);
  });
});

describe("OpenAI plugin - models", () => {
  let app: Hono;

  beforeEach(() => {
    app = createOpenAITestApp({ models: ["custom-local-model"] }).app;
  });

  it("lists seeded default models plus extras", async () => {
    const res = await app.request(`${base}/v1/models`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe("list");
    const ids = body.data.map((m: any) => m.id);
    expect(ids).toContain("gpt-4o");
    expect(ids).toContain("text-embedding-3-small");
    expect(ids).toContain("custom-local-model");
  });

  it("gets a model by id", async () => {
    const res = await app.request(`${base}/v1/models/gpt-4o`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.object).toBe("model");
    expect(body.id).toBe("gpt-4o");
    expect(body.owned_by).toBe("openai");
  });
});

describe("OpenAI plugin - audio", () => {
  let app: Hono;

  beforeEach(() => {
    app = createOpenAITestApp({
      transcripts: [{ filename_contains: "meeting", text: "Seeded meeting transcript" }],
    }).app;
  });

  it("transcribes multipart audio with seeded text and verbose_json", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "meeting.wav"));
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("language", "en");

    const res = await app.request(`${base}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiTestKey}` },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.text).toBe("Seeded meeting transcript");
    expect(body.duration).toBeGreaterThan(0);
    expect(body.language).toBe("en");
    expect(body.segments.length).toBeGreaterThan(0);
  });

  it("translates audio", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "clip.mp3"));
    form.append("model", "whisper-1");
    const res = await app.request(`${base}/v1/audio/translations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiTestKey}` },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.text).toContain("Emulated English translation");
  });

  it("returns binary speech audio", async () => {
    const res = await app.request(`${base}/v1/audio/speech`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        model: "tts-1",
        input: "hello speech",
        voice: "alloy",
        response_format: "wav",
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("audio/wav");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.toString("utf8", 0, 4)).toBe("RIFF");
  });
});

describe("OpenAI plugin - moderations", () => {
  it("flags seedable trigger words", async () => {
    const app = createOpenAITestApp({
      moderation_triggers: [{ contains: "bananas", categories: ["violence"] }],
    }).app;
    const clean = await app.request(`${base}/v1/moderations`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ input: "hello there" }),
    });
    const cleanBody = (await clean.json()) as any;
    expect(cleanBody.results[0].flagged).toBe(false);

    const flagged = await app.request(`${base}/v1/moderations`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ input: "I love bananas" }),
    });
    const flaggedBody = (await flagged.json()) as any;
    expect(flaggedBody.results[0].flagged).toBe(true);
    expect(flaggedBody.results[0].categories.violence).toBe(true);
  });
});

describe("OpenAI plugin - files and batches", () => {
  it("uploads, lists, downloads, and deletes files", async () => {
    const app = createOpenAITestApp().app;
    const form = new FormData();
    form.append("file", new File(["hello file"], "note.txt", { type: "text/plain" }));
    form.append("purpose", "user_data");

    const created = await app.request(`${base}/v1/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiTestKey}` },
      body: form,
    });
    expect(created.status).toBe(200);
    const file = (await created.json()) as any;
    expect(file.id).toMatch(/^file-/);
    expect(file.object).toBe("file");
    expect(file.status).toBe("processed");
    expect(file.filename).toBe("note.txt");

    const listed = await app.request(`${base}/v1/files?purpose=user_data`, {
      headers: authHeaders(),
    });
    const listBody = (await listed.json()) as any;
    expect(listBody.data.some((f: any) => f.id === file.id)).toBe(true);

    const content = await app.request(`${base}/v1/files/${file.id}/content`, {
      headers: authHeaders(),
    });
    expect(await content.text()).toBe("hello file");

    const del = await app.request(`${base}/v1/files/${file.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect((await del.json() as any).deleted).toBe(true);
  });

  it("rejects invalid file purpose", async () => {
    const app = createOpenAITestApp().app;
    const form = new FormData();
    form.append("file", new File(["x"], "x.txt"));
    form.append("purpose", "nope");
    const res = await app.request(`${base}/v1/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiTestKey}` },
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("runs a chat batch end to end and downloads output JSONL", async () => {
    const app = createOpenAITestApp({
      responses: [{ match: { content_contains: "batch-hi" }, reply: "batch-ok" }],
    }).app;

    const jsonl = [
      JSON.stringify({
        custom_id: "1",
        method: "POST",
        url: "/v1/chat/completions",
        body: {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: "batch-hi" }],
        },
      }),
      JSON.stringify({
        custom_id: "2",
        method: "POST",
        url: "/v1/embeddings",
        body: {
          model: "text-embedding-3-small",
          input: "embed me",
        },
      }),
    ].join("\n");

    const form = new FormData();
    form.append("file", new File([jsonl], "batch.jsonl", { type: "application/jsonl" }));
    form.append("purpose", "batch");
    const upload = await app.request(`${base}/v1/files`, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiTestKey}` },
      body: form,
    });
    const inputFile = (await upload.json()) as any;

    const batchRes = await app.request(`${base}/v1/batches`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        input_file_id: inputFile.id,
        endpoint: "/v1/chat/completions",
        completion_window: "24h",
      }),
    });
    expect(batchRes.status).toBe(200);
    const batch = (await batchRes.json()) as any;
    expect(batch.id).toMatch(/^batch_/);
    expect(batch.status).toBe("completed");
    expect(batch.request_counts.total).toBe(2);
    expect(batch.request_counts.completed).toBe(2);
    expect(batch.output_file_id).toBeTruthy();

    const get = await app.request(`${base}/v1/batches/${batch.id}`, { headers: authHeaders() });
    expect((await get.json() as any).id).toBe(batch.id);

    const list = await app.request(`${base}/v1/batches`, { headers: authHeaders() });
    expect(((await list.json()) as any).data.some((b: any) => b.id === batch.id)).toBe(true);

    const output = await app.request(`${base}/v1/files/${batch.output_file_id}/content`, {
      headers: authHeaders(),
    });
    const lines = (await output.text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0].custom_id).toBe("1");
    expect(lines[0].response.body.choices[0].message.content).toBe("batch-ok");
    expect(lines[1].custom_id).toBe("2");
    expect(lines[1].response.body.data[0].embedding).toHaveLength(1536);
  });
});

describe("OpenAI plugin - inspector", () => {
  it("renders inspector HTML", async () => {
    const app = createOpenAITestApp().app;
    const res = await app.request(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("OpenAI Inspector");
    expect(html).toContain("Request Log");
  });
});

describe("OpenAI plugin - seedFromConfig idempotency", () => {
  it("skips existing seeded records on re-run", async () => {
    const { store } = createOpenAITestApp();
    const config = {
      api_keys: ["sk-once"],
      models: ["extra-model"],
      responses: [{ match: { content_contains: "x" }, reply: "y" }],
      transcripts: [{ text: "t" }],
      moderation_triggers: [{ contains: "z" }],
    };
    seedFromConfig(store, base, config);
    seedFromConfig(store, base, config);
    const os = getOpenAIStore(store);
    expect(os.apiKeys.count((k) => k.key === "sk-once")).toBe(1);
    expect(os.models.count((m) => m.model_id === "extra-model")).toBe(1);
    expect(os.responseMatchers.count()).toBe(1);
    expect(os.transcripts.count()).toBe(1);
    expect(os.moderationTriggers.count()).toBe(1);
  });
});
