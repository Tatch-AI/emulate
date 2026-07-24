import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Context, ContentfulStatusCode, WebhookDispatcher } from "@emulators/core";
import type { DeepgramApiKey, DeepgramTranscriptMatcher } from "./entities.js";
import type { DeepgramStore } from "./store.js";

export const DEFAULT_TRANSCRIPT =
  "Hello, this is a test transcription from the Deepgram emulator.";

export const DEFAULT_SUMMARY = "A brief summary of the provided content.";

export function generateUuid(): string {
  return randomUUID();
}

export function generateOpaqueToken(prefix = "dg"): string {
  return `${prefix}_${randomBytes(24).toString("hex")}`;
}

export function sha256Hex(data: string | Uint8Array | ArrayBuffer): string {
  const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data as ArrayBuffer);
  return createHash("sha256").update(buf).digest("hex");
}

export function modelUuid(name: string): string {
  return createHash("sha256").update(`deepgram-model:${name}`).digest("hex").slice(0, 36).replace(
    /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
    "$1-$2-$3-$4-$5",
  );
}

export function deepgramError(c: Context, status: number, errCode: string, errMsg: string, requestId?: string) {
  const request_id = requestId ?? generateUuid();
  return c.json(
    {
      err_code: errCode,
      err_msg: errMsg,
      request_id,
    },
    status as ContentfulStatusCode,
  );
}

export function parseAuthHeader(c: Context): { scheme: "token" | "bearer"; value: string } | null {
  const header = c.req.header("Authorization") ?? c.req.header("authorization") ?? "";
  const match = /^(Token|Bearer)\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase() === "bearer" ? "bearer" : "token";
  return { scheme, value: match[2] };
}

export interface AuthResult {
  ok: true;
  apiKey: DeepgramApiKey | null;
  via: "api_key" | "temp_token" | "open";
  token: string;
}

export function requireDeepgramAuth(
  c: Context,
  ds: DeepgramStore,
  options: { apiKeyOnly?: boolean } = {},
): AuthResult | Response {
  const parsed = parseAuthHeader(c);
  if (!parsed) {
    return deepgramError(c, 401, "INVALID_AUTH", "Invalid credentials.");
  }

  const now = Date.now();
  const seededKeys = ds.apiKeys.all().filter((key) => {
    if (!key.expiration_date) return true;
    return Date.parse(key.expiration_date) > now;
  });

  if (parsed.scheme === "bearer" || parsed.scheme === "token") {
    const temp = ds.tempTokens.findOneBy("access_token", parsed.value);
    if (temp) {
      if (options.apiKeyOnly) {
        return deepgramError(c, 401, "INVALID_AUTH", "API key required.");
      }
      if (temp.expires_at <= now) {
        return deepgramError(c, 401, "INVALID_AUTH", "Token expired.");
      }
      const apiKey = temp.api_key_id
        ? (ds.apiKeys.findOneBy("api_key_id", temp.api_key_id) ?? null)
        : null;
      return { ok: true, apiKey, via: "temp_token", token: parsed.value };
    }
  }

  if (seededKeys.length === 0) {
    return { ok: true, apiKey: null, via: "open", token: parsed.value };
  }

  const found = seededKeys.find((key) => key.key === parsed.value);
  if (!found) {
    return deepgramError(c, 401, "INVALID_AUTH", "Invalid credentials.");
  }

  return { ok: true, apiKey: found, via: "api_key", token: parsed.value };
}

export function queryBool(c: Context, name: string): boolean {
  const value = c.req.query(name);
  if (value == null) return false;
  if (value === "" || value.toLowerCase() === "true" || value === "1") return true;
  if (value.toLowerCase() === "false" || value === "0") return false;
  return Boolean(value);
}

export function queryInt(c: Context, name: string, fallback?: number): number | undefined {
  const value = c.req.query(name);
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function matchTranscript(
  matchers: DeepgramTranscriptMatcher[],
  opts: { url?: string | null; text?: string | null; binary?: boolean },
): DeepgramTranscriptMatcher {
  if (opts.url) {
    for (const matcher of matchers) {
      const contains = matcher.match?.url_contains;
      if (contains && opts.url.includes(contains)) return matcher;
    }
  }

  if (opts.text) {
    for (const matcher of matchers) {
      const contains = matcher.match?.text_contains;
      if (contains && opts.text.includes(contains)) return matcher;
    }
  }

  // Catch-all matchers (no url_contains / text_contains) for binary uploads and unmatched URLs
  const catchAll = matchers.find((m) => !m.match?.url_contains && !m.match?.text_contains);
  if (catchAll) return catchAll;

  return {
    text: DEFAULT_TRANSCRIPT,
    duration: 3.6,
    speakers: 1,
    summary: DEFAULT_SUMMARY,
  };
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence: number;
  punctuated_word: string;
  speaker?: number;
  speaker_confidence?: number;
}

export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  if (!parts) return [text];
  return parts.map((p) => p.trim()).filter(Boolean);
}

export function buildWords(
  transcript: string,
  duration: number,
  options: {
    punctuate: boolean;
    diarize: boolean;
    speakers: number;
  },
): { displayTranscript: string; words: WordTiming[] } {
  const keepPunct = options.punctuate;
  const rawTokens = transcript.trim().split(/\s+/).filter(Boolean);
  const displayTokens = rawTokens.map((token) => {
    if (keepPunct) return token;
    return token.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");
  });
  const displayTranscript = displayTokens.filter(Boolean).join(" ");

  const count = Math.max(displayTokens.filter(Boolean).length, 1);
  const step = duration / count;
  const sentences = splitSentences(transcript);
  const speakerCount = Math.max(options.speakers, 1);

  let sentenceIdx = 0;
  let consumed = 0;
  const sentenceWordCounts = sentences.map((s) => s.trim().split(/\s+/).filter(Boolean).length);

  const words: WordTiming[] = [];
  let wordIndex = 0;
  for (let i = 0; i < rawTokens.length; i++) {
    const punctuated = rawTokens[i];
    const cleaned = displayTokens[i];
    if (!cleaned) continue;

    while (sentenceIdx < sentenceWordCounts.length - 1 && wordIndex >= consumed + sentenceWordCounts[sentenceIdx]) {
      consumed += sentenceWordCounts[sentenceIdx];
      sentenceIdx++;
    }

    const start = Number((wordIndex * step).toFixed(3));
    const end = Number(((wordIndex + 1) * step).toFixed(3));
    const entry: WordTiming = {
      word: cleaned.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "") || cleaned,
      start,
      end,
      confidence: 0.99,
      punctuated_word: keepPunct ? punctuated : cleaned,
    };
    if (options.diarize) {
      entry.speaker = sentenceIdx % speakerCount;
      entry.speaker_confidence = 0.95;
    }
    words.push(entry);
    wordIndex++;
  }

  return { displayTranscript, words };
}

export function buildUtterances(
  words: WordTiming[],
  transcript: string,
  diarize: boolean,
  channel = 0,
): Array<{
  start: number;
  end: number;
  confidence: number;
  channel: number;
  transcript: string;
  words: WordTiming[];
  speaker?: number;
  id: string;
}> {
  const sentences = splitSentences(transcript);
  if (sentences.length === 0 || words.length === 0) {
    return [
      {
        start: words[0]?.start ?? 0,
        end: words[words.length - 1]?.end ?? 0,
        confidence: 0.99,
        channel,
        transcript,
        words,
        speaker: diarize ? 0 : undefined,
        id: generateUuid(),
      },
    ];
  }

  const utterances = [];
  let cursor = 0;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const sentenceWordCount = sentence.trim().split(/\s+/).filter(Boolean).length;
    const slice = words.slice(cursor, cursor + sentenceWordCount);
    cursor += sentenceWordCount;
    if (slice.length === 0) continue;
    utterances.push({
      start: slice[0].start,
      end: slice[slice.length - 1].end,
      confidence: 0.99,
      channel,
      transcript: sentence.trim(),
      words: slice,
      speaker: diarize ? (slice[0].speaker ?? i % 2) : undefined,
      id: generateUuid(),
    });
  }
  return utterances;
}

export function buildParagraphs(
  utterances: ReturnType<typeof buildUtterances>,
  transcript: string,
): { transcript: string; paragraphs: Array<{ sentences: Array<{ text: string; start: number; end: number }>; speaker?: number; num_words: number; start: number; end: number }> } {
  return {
    transcript,
    paragraphs: utterances.map((utt) => ({
      sentences: [{ text: utt.transcript, start: utt.start, end: utt.end }],
      speaker: utt.speaker,
      num_words: utt.words.length,
      start: utt.start,
      end: utt.end,
    })),
  };
}

export function modelInfoFor(model: string): { uuid: string; info: Record<string, { name: string; version: string; arch: string }> } {
  const uuid = modelUuid(model);
  const arch = model.startsWith("nova-3")
    ? "nova-3"
    : model.startsWith("nova-2")
      ? "nova-2"
      : model.startsWith("whisper")
        ? "whisper"
        : model.startsWith("aura")
          ? "aura"
          : model;
  const name = model.includes("general") || model.includes("aura") || model.includes("whisper") ? model : `${model}-general`;
  return {
    uuid,
    info: {
      [uuid]: {
        name,
        version: "2024-01-01.0",
        arch,
      },
    },
  };
}

export function resolveProjectId(ds: DeepgramStore, apiKey: DeepgramApiKey | null): string {
  if (apiKey?.project_id) return apiKey.project_id;
  const first = ds.projects.all()[0];
  if (first) return first.project_id;
  const created = ds.projects.insert({
    project_id: generateUuid(),
    name: "Default",
    company: null,
  });
  return created.project_id;
}

export function recordUsage(
  ds: DeepgramStore,
  opts: {
    request_id: string;
    project_id: string;
    path: string;
    code: number;
    duration_hours: number;
    api_key_id: string | null;
  },
): void {
  ds.usageRequests.insert({
    request_id: opts.request_id,
    project_id: opts.project_id,
    created: new Date().toISOString(),
    path: opts.path,
    code: opts.code,
    duration_hours: opts.duration_hours,
    api_key_id: opts.api_key_id,
  });
}

export async function dispatchCallback(
  ds: DeepgramStore,
  webhooks: WebhookDispatcher,
  opts: {
    url: string;
    request_id: string;
    payload: unknown;
    dgToken: string;
  },
): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "dg-token": opts.dgToken,
  };

  let status_code: number | null = null;
  let success = false;
  let error: string | null = null;

  const hook = webhooks.register({
    url: opts.url,
    events: ["transcription.complete"],
    active: true,
    owner: "deepgram",
  });

  try {
    const response = await fetch(opts.url, {
      method: "POST",
      headers,
      body: JSON.stringify(opts.payload),
      signal: AbortSignal.timeout(10_000),
    });
    status_code = response.status;
    success = response.ok;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  ds.callbackDeliveries.insert({
    delivery_id: generateUuid(),
    request_id: opts.request_id,
    url: opts.url,
    status_code,
    success,
    error,
    headers,
    payload: opts.payload,
    delivered_at: new Date().toISOString(),
  });

  await webhooks.dispatch("transcription.complete", undefined, opts.payload, "deepgram");
  webhooks.unregister(hook.id);
}

export function buildWavBytes(charCount: number): Uint8Array {
  const dataSize = Math.max(44, 44 + charCount * 16);
  const buffer = new ArrayBuffer(dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // RIFF header
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  view.setUint32(4, dataSize - 8, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set([0x64, 0x61, 0x74, 0x61], 36); // data
  view.setUint32(40, dataSize - 44, true);

  for (let i = 44; i < dataSize; i++) {
    bytes[i] = (i * 17 + charCount) % 256;
  }
  return bytes;
}

export function buildMpegBytes(charCount: number): Uint8Array {
  // Minimal MPEG frame-ish header plus padding proportional to text length
  const size = Math.max(128, 64 + charCount * 12);
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xfb;
  bytes[2] = 0x90;
  bytes[3] = 0x00;
  for (let i = 4; i < size; i++) {
    bytes[i] = (i * 31 + charCount) % 256;
  }
  return bytes;
}

export function detectSentiment(text: string): { sentiment: "positive" | "neutral" | "negative"; sentiment_score: number } {
  const lower = text.toLowerCase();
  if (/(great|love|excellent|happy|amazing|wonderful|good)/.test(lower)) {
    return { sentiment: "positive", sentiment_score: 0.82 };
  }
  if (/(bad|hate|terrible|awful|angry|poor|worst)/.test(lower)) {
    return { sentiment: "negative", sentiment_score: -0.74 };
  }
  return { sentiment: "neutral", sentiment_score: 0.05 };
}

export function detectTopics(text: string): Array<{ topic: string; confidence_score: number }> {
  const lower = text.toLowerCase();
  const topics: Array<{ topic: string; confidence_score: number }> = [];
  if (/(billing|invoice|payment|charge)/.test(lower)) topics.push({ topic: "Billing", confidence_score: 0.91 });
  if (/(support|help|issue|problem)/.test(lower)) topics.push({ topic: "Support", confidence_score: 0.88 });
  if (/(product|feature|software|api)/.test(lower)) topics.push({ topic: "Product", confidence_score: 0.8 });
  if (topics.length === 0) topics.push({ topic: "General", confidence_score: 0.7 });
  return topics;
}

export function detectIntents(text: string): Array<{ intent: string; confidence_score: number }> {
  const lower = text.toLowerCase();
  if (/\?/.test(text) || /^(who|what|when|where|why|how|can|could|is|are)\b/i.test(lower)) {
    return [{ intent: "Ask question", confidence_score: 0.9 }];
  }
  if (/(please|need|want|looking for)/.test(lower)) {
    return [{ intent: "Request help", confidence_score: 0.85 }];
  }
  return [{ intent: "Inform", confidence_score: 0.75 }];
}

export function maskKey(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
