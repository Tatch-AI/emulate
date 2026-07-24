import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bearerHeaders,
  createDeepgramTestApp,
  deepgramTestKey,
  getDeepgramStore,
  tokenHeaders,
  waitFor,
} from "./helpers.js";
import { seedFromConfig } from "../index.js";

const base = "http://localhost:4000";

describe("Deepgram plugin - auth", () => {
  it("returns INVALID_AUTH without Authorization", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/v1/listen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { err_code: string; err_msg: string; request_id: string };
    expect(body.err_code).toBe("INVALID_AUTH");
    expect(body.request_id).toBeTruthy();
  });

  it("rejects unknown keys when keys are seeded", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/v1/projects`, {
      headers: tokenHeaders("wrong_key"),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { err_code: string };
    expect(body.err_code).toBe("INVALID_AUTH");
  });

  it("accepts any key when none are seeded", async () => {
    const { app, store } = createDeepgramTestApp({ projects: [{ name: "Default" }] });
    expect(getDeepgramStore(store).apiKeys.count()).toBe(0);
    const res = await app.request(`${base}/v1/projects`, {
      headers: tokenHeaders("anything"),
    });
    expect(res.status).toBe(200);
  });

  it("accepts Bearer with an api key for leniency", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/v1/projects`, {
      headers: bearerHeaders(deepgramTestKey),
    });
    expect(res.status).toBe(200);
  });
});

describe("Deepgram plugin - listen", () => {
  it("transcribes a URL JSON body", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "Hello world from seed.", duration: 2 }],
    });
    const res = await app.request(`${base}/v1/listen?model=nova-3&punctuate=true`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://cdn.example.com/audio.wav" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.metadata.request_id).toBeTruthy();
    expect(body.metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(body.metadata.duration).toBe(2);
    expect(body.results.channels[0].alternatives[0].transcript).toBe("Hello world from seed.");
    expect(body.results.channels[0].alternatives[0].words.length).toBeGreaterThan(0);
  });

  it("transcribes raw binary audio", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "Binary upload transcript." }],
    });
    const audio = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const res = await app.request(`${base}/v1/listen?model=nova-2`, {
      method: "POST",
      headers: { Authorization: `Token ${deepgramTestKey}`, "Content-Type": "audio/wav" },
      body: audio,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.results.channels[0].alternatives[0].transcript).toContain("binary");
    expect(body.metadata.models).toHaveLength(1);
  });

  it("selects seeded matcher by url_contains", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [
        { match: { url_contains: "spacewalk" }, text: "We choose to go to the moon." },
        { text: "Default fallback transcript." },
      ],
    });
    const matched = await app.request(`${base}/v1/listen?punctuate=true`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://dpgr.am/spacewalk.wav" }),
    });
    expect(((await matched.json()) as any).results.channels[0].alternatives[0].transcript).toBe(
      "We choose to go to the moon.",
    );

    const fallback = await app.request(`${base}/v1/listen?punctuate=true`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/other.wav" }),
    });
    expect(((await fallback.json()) as any).results.channels[0].alternatives[0].transcript).toBe(
      "Default fallback transcript.",
    );
  });

  it("lowercases and strips punctuation when punctuate and smart_format are off", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "Hello, World!" }],
    });
    const res = await app.request(`${base}/v1/listen`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    const alt = ((await res.json()) as any).results.channels[0].alternatives[0];
    expect(alt.transcript).toBe("hello world");
    expect(alt.words[0].punctuated_word).toBe("hello");
  });

  it("keeps punctuation when punctuate is on", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "Hello, World!" }],
    });
    const res = await app.request(`${base}/v1/listen?punctuate=true`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    const alt = ((await res.json()) as any).results.channels[0].alternatives[0];
    expect(alt.transcript).toBe("Hello, World!");
    expect(alt.words[0].punctuated_word).toBe("Hello,");
  });

  it("adds diarize speaker fields", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "Hello there. How are you?", speakers: 2 }],
    });
    const res = await app.request(`${base}/v1/listen?diarize=true&punctuate=true`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    const words = ((await res.json()) as any).results.channels[0].alternatives[0].words;
    expect(words.some((w: any) => w.speaker === 0)).toBe(true);
    expect(words.some((w: any) => w.speaker === 1)).toBe(true);
    expect(words[0].speaker_confidence).toBeDefined();
  });

  it("returns utterances array when utterances=true", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "One sentence. Two sentence." }],
    });
    const res = await app.request(`${base}/v1/listen?utterances=true&punctuate=true`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    const body = (await res.json()) as any;
    expect(Array.isArray(body.results.utterances)).toBe(true);
    expect(body.results.utterances.length).toBeGreaterThanOrEqual(2);
    expect(body.results.utterances[0].id).toBeTruthy();
  });

  it("returns summarize v2 summary", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "Long form content about rockets.", summary: "Rockets overview." }],
    });
    const res = await app.request(`${base}/v1/listen?summarize=v2`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    const body = (await res.json()) as any;
    expect(body.results.summary).toEqual({ result: "success", short: "Rockets overview." });
  });

  it("adds detect_language fields", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/v1/listen?detect_language=true&language=en`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    const channel = ((await res.json()) as any).results.channels[0];
    expect(channel.detected_language).toBe("en");
    expect(channel.language_confidence).toBeGreaterThan(0.9);
  });

  it("duplicates channels when channels=2", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/v1/listen?channels=2&multichannel=true`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    const body = (await res.json()) as any;
    expect(body.metadata.channels).toBe(2);
    expect(body.results.channels).toHaveLength(2);
    expect(body.results.channels[0].alternatives[0].transcript).toBe(
      body.results.channels[1].alternatives[0].transcript,
    );
  });

  it("generates monotonic word timings", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "one two three four", duration: 4 }],
    });
    const res = await app.request(`${base}/v1/listen`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    const words = ((await res.json()) as any).results.channels[0].alternatives[0].words;
    for (let i = 1; i < words.length; i++) {
      expect(words[i].start).toBeGreaterThanOrEqual(words[i - 1].start);
      expect(words[i].end).toBeGreaterThan(words[i].start);
    }
  });

  it("posts full result to callback with dg-token", async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        captured.push({ url: String(input), init: init ?? {} });
        return { ok: true, status: 200, text: async () => "" };
      }),
    );

    const { app, store } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "Async callback transcript." }],
    });

    const res = await app.request(
      `${base}/v1/listen?callback=${encodeURIComponent("https://hooks.example/dg")}`,
      {
        method: "POST",
        headers: tokenHeaders(),
        body: JSON.stringify({ url: "https://example.com/a.wav" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { request_id: string };
    expect(body.request_id).toBeTruthy();

    await waitFor(() => getDeepgramStore(store).callbackDeliveries.count() > 0);
    const delivery = getDeepgramStore(store).callbackDeliveries.all()[0];
    expect(delivery.url).toBe("https://hooks.example/dg");
    expect(delivery.headers["dg-token"]).toBeTruthy();
    expect((delivery.payload as any).results.channels[0].alternatives[0].transcript).toContain("async");
    expect(captured.some((r) => r.url === "https://hooks.example/dg")).toBe(true);
    const headers = captured[0].init.headers as Record<string, string>;
    expect(headers["dg-token"]).toBeTruthy();

    vi.unstubAllGlobals();
  });

  it("returns 400 on missing body", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/v1/listen`, {
      method: "POST",
      headers: { Authorization: `Token ${deepgramTestKey}`, "Content-Type": "audio/wav" },
      body: new Uint8Array(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { err_code: string; request_id: string };
    expect(body.err_code).toBe("Bad Request");
    expect(body.request_id).toBeTruthy();
  });
});

describe("Deepgram plugin - speak", () => {
  it("returns audio bytes with dg headers", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/v1/speak?model=aura-2-thalia-en&container=wav`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ text: "Hello Deepgram" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/wav");
    expect(res.headers.get("dg-request-id")).toBeTruthy();
    expect(res.headers.get("dg-model-name")).toBe("aura-2-thalia-en");
    expect(res.headers.get("dg-model-uuid")).toBeTruthy();
    expect(res.headers.get("dg-char-count")).toBe(String("Hello Deepgram".length));
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(44);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("RIFF");
  });

  it("returns mpeg for mp3 container", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/v1/speak?container=mp3&encoding=mp3`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ text: "mp3 please" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("audio/mpeg");
  });

  it("validates text presence", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/v1/speak`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).err_code).toBe("Bad Request");
  });
});

describe("Deepgram plugin - read", () => {
  it("returns summarize sentiment topics intents shapes", async () => {
    const { app } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: [deepgramTestKey],
      read: [{ match: { text_contains: "billing" }, text: "ignored", summary: "Customer asked about billing." }],
    });
    const res = await app.request(
      `${base}/v1/read?summarize=true&sentiment=true&topics=true&intents=true`,
      {
        method: "POST",
        headers: tokenHeaders(),
        body: JSON.stringify({ text: "I love your product but need billing help?" }),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.metadata.request_id).toBeTruthy();
    expect(body.results.summary.text).toContain("billing");
    expect(body.results.topics.segments[0].topics.length).toBeGreaterThan(0);
    expect(body.results.sentiments.average.sentiment).toBeTruthy();
    expect(body.results.intents.segments[0].intents[0].intent).toBeTruthy();
  });
});

describe("Deepgram plugin - auth grant", () => {
  it("issues a temp token accepted as Bearer on listen", async () => {
    const { app } = createDeepgramTestApp();
    const grant = await app.request(`${base}/v1/auth/grant`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ ttl_seconds: 60 }),
    });
    expect(grant.status).toBe(200);
    const { access_token, expires_in } = (await grant.json()) as {
      access_token: string;
      expires_in: number;
    };
    expect(access_token).toBeTruthy();
    expect(expires_in).toBe(60);

    const listen = await app.request(`${base}/v1/listen`, {
      method: "POST",
      headers: bearerHeaders(access_token),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    expect(listen.status).toBe(200);
  });

  it("rejects expired temp tokens", async () => {
    const { app, store } = createDeepgramTestApp();
    const grant = await app.request(`${base}/v1/auth/grant`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ ttl_seconds: 1 }),
    });
    const { access_token } = (await grant.json()) as { access_token: string };
    const token = getDeepgramStore(store).tempTokens.findOneBy("access_token", access_token)!;
    getDeepgramStore(store).tempTokens.update(token.id, { expires_at: Date.now() - 1000 });

    const listen = await app.request(`${base}/v1/listen`, {
      method: "POST",
      headers: bearerHeaders(access_token),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });
    expect(listen.status).toBe(401);
    expect(((await listen.json()) as any).err_code).toBe("INVALID_AUTH");
  });
});

describe("Deepgram plugin - projects and keys", () => {
  let setup: ReturnType<typeof createDeepgramTestApp>;

  beforeEach(() => {
    setup = createDeepgramTestApp();
  });

  it("lists and patches projects", async () => {
    const list = await setup.app.request(`${base}/v1/projects`, { headers: tokenHeaders() });
    expect(list.status).toBe(200);
    const projects = ((await list.json()) as any).projects;
    expect(projects[0].name).toBe("Default");
    const id = projects[0].project_id;

    const patched = await setup.app.request(`${base}/v1/projects/${id}`, {
      method: "PATCH",
      headers: tokenHeaders(),
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(patched.status).toBe(200);

    const got = await setup.app.request(`${base}/v1/projects/${id}`, { headers: tokenHeaders() });
    expect(((await got.json()) as any).name).toBe("Renamed");
  });

  it("creates a key that authenticates and deletes stop auth", async () => {
    const projectId = getDeepgramStore(setup.store).projects.all()[0].project_id;
    const created = await setup.app.request(`${base}/v1/projects/${projectId}/keys`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ comment: "ci", scopes: ["member", "usage:write"] }),
    });
    expect(created.status).toBe(200);
    const keyBody = (await created.json()) as { api_key_id: string; key: string };
    expect(keyBody.key).toBeTruthy();

    const ok = await setup.app.request(`${base}/v1/projects`, {
      headers: tokenHeaders(keyBody.key),
    });
    expect(ok.status).toBe(200);

    const deleted = await setup.app.request(`${base}/v1/projects/${projectId}/keys/${keyBody.api_key_id}`, {
      method: "DELETE",
      headers: tokenHeaders(),
    });
    expect(deleted.status).toBe(200);

    const denied = await setup.app.request(`${base}/v1/projects`, {
      headers: tokenHeaders(keyBody.key),
    });
    expect(denied.status).toBe(401);
  });

  it("lists members", async () => {
    const projectId = getDeepgramStore(setup.store).projects.all()[0].project_id;
    const res = await setup.app.request(`${base}/v1/projects/${projectId}/members`, {
      headers: tokenHeaders(),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).members.length).toBeGreaterThan(0);
  });

  it("populates usage request log from listen calls", async () => {
    const projectId = getDeepgramStore(setup.store).projects.all()[0].project_id;
    await setup.app.request(`${base}/v1/listen`, {
      method: "POST",
      headers: tokenHeaders(),
      body: JSON.stringify({ url: "https://example.com/a.wav" }),
    });

    const requests = await setup.app.request(`${base}/v1/projects/${projectId}/requests`, {
      headers: tokenHeaders(),
    });
    const reqBody = (await requests.json()) as any;
    expect(reqBody.requests.some((r: any) => r.path === "/v1/listen")).toBe(true);

    const usage = await setup.app.request(`${base}/v1/projects/${projectId}/usage`, {
      headers: tokenHeaders(),
    });
    const usageBody = (await usage.json()) as any;
    expect(usageBody.total_requests).toBeGreaterThan(0);
    expect(usageBody.total_hours).toBeGreaterThan(0);
  });

  it("deletes projects", async () => {
    const projectId = getDeepgramStore(setup.store).projects.all()[0].project_id;
    const res = await setup.app.request(`${base}/v1/projects/${projectId}`, {
      method: "DELETE",
      headers: tokenHeaders(),
    });
    expect(res.status).toBe(200);
    expect(getDeepgramStore(setup.store).projects.count()).toBe(0);
  });
});

describe("Deepgram plugin - seed and inspector", () => {
  it("seedFromConfig is idempotent", () => {
    const { store } = createDeepgramTestApp({
      projects: [{ name: "Default" }],
      api_keys: ["k1"],
      transcripts: [{ text: "once" }],
    });
    seedFromConfig(store, base, {
      projects: [{ name: "Default" }],
      api_keys: ["k1"],
      transcripts: [{ text: "once" }],
    });
    expect(getDeepgramStore(store).projects.count()).toBe(1);
    expect(getDeepgramStore(store).apiKeys.count()).toBe(1);
  });

  it("renders inspector", async () => {
    const { app } = createDeepgramTestApp();
    const res = await app.request(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Deepgram Inspector");
    expect(html).toContain("Transcription");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
