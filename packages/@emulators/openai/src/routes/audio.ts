import type { Context, RouteContext } from "@emulators/core";
import { getOpenAIStore, type OpenAIStore } from "../store.js";
import {
  applyOpenAIHeaders,
  estimateTokens,
  logRequest,
  modelExists,
  openaiError,
  parseJsonBody,
  requireOpenAIAuth,
} from "../helpers.js";

export function audioRoutes({ app, store }: RouteContext): void {
  const os = () => getOpenAIStore(store);

  app.post("/v1/audio/transcriptions", async (c) => handleTranscription(c, os(), false));
  app.post("/v1/audio/translations", async (c) => handleTranscription(c, os(), true));

  app.post("/v1/audio/speech", async (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    const rid = applyOpenAIHeaders(c);

    const bodyOrErr = await parseJsonBody(c);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const model = (body.model as string | undefined) ?? "tts-1";
    const input = body.input as string | undefined;
    if (!input) {
      return openaiError(c, 400, "Missing required parameter: 'input'", "invalid_request_error", null, "input");
    }
    if (!modelExists(os(), model)) {
      return openaiError(c, 404, `The model '${model}' does not exist`, "invalid_request_error", "model_not_found", "model");
    }

    const format = ((body.response_format as string | undefined) ?? "mp3").toLowerCase();
    const payload = buildFakeAudio(input, format);

    logRequest(os(), {
      request_id: rid,
      method: "POST",
      path: "/v1/audio/speech",
      model,
      prompt_preview: input,
      reply_preview: `audio/${format} ${payload.byteLength}b`,
      prompt_tokens: estimateTokens(input),
      completion_tokens: 0,
      streamed: false,
    });

    const contentType =
      format === "wav" || format === "pcm"
        ? "audio/wav"
        : format === "opus"
          ? "audio/opus"
          : format === "aac"
            ? "audio/aac"
            : format === "flac"
              ? "audio/flac"
              : "audio/mpeg";

    return c.body(payload, 200, { "Content-Type": contentType });
  });
}

async function handleTranscription(c: Context, os: OpenAIStore, isTranslation: boolean) {
  const auth = requireOpenAIAuth(c, os);
  if (auth !== true) return auth;
  const rid = applyOpenAIHeaders(c);

  const form = await c.req.parseBody();
  const fileEntry = Array.isArray(form.file) ? form.file[0] : form.file;
  const model = String(form.model ?? "whisper-1");
  const responseFormat = String(form.response_format ?? "json");
  const language = form.language ? String(form.language) : "en";
  const prompt = form.prompt ? String(form.prompt) : "";

  if (!fileEntry) {
    return openaiError(c, 400, "Missing required parameter: 'file'", "invalid_request_error", null, "file");
  }
  if (!modelExists(os, model)) {
    return openaiError(c, 404, `The model '${model}' does not exist`, "invalid_request_error", "model_not_found", "model");
  }

  const filename =
    typeof fileEntry === "string" ? "audio.wav" : fileEntry instanceof File ? fileEntry.name || "audio.wav" : "audio.wav";
  const text = resolveTranscript(os, filename, prompt, isTranslation);

  logRequest(os, {
    request_id: rid,
    method: "POST",
    path: isTranslation ? "/v1/audio/translations" : "/v1/audio/transcriptions",
    model,
    prompt_preview: filename,
    reply_preview: text,
    prompt_tokens: estimateTokens(text),
    completion_tokens: 0,
    streamed: false,
  });

  if (responseFormat === "text") {
    return c.text(text);
  }
  if (responseFormat === "srt") {
    return c.text(toSrt(text));
  }
  if (responseFormat === "vtt") {
    return c.text(toVtt(text));
  }
  if (responseFormat === "verbose_json") {
    const words = text.split(/\s+/).filter(Boolean);
    const duration = Math.max(1, words.length * 0.4);
    const segments = [
      {
        id: 0,
        seek: 0,
        start: 0,
        end: duration,
        text: ` ${text}`,
        tokens: [],
        temperature: 0,
        avg_logprob: -0.2,
        compression_ratio: 1.2,
        no_speech_prob: 0.01,
      },
    ];
    return c.json({
      task: isTranslation ? "translate" : "transcribe",
      language,
      duration,
      text,
      segments,
    });
  }

  return c.json({ text });
}

function resolveTranscript(
  os: ReturnType<typeof getOpenAIStore>,
  filename: string,
  prompt: string,
  isTranslation: boolean,
): string {
  const seeds = os.transcripts.all();
  for (const seed of seeds) {
    if (!seed.filename_contains || filename.includes(seed.filename_contains)) {
      return seed.text;
    }
  }
  if (prompt) return `Emulated transcript from prompt: ${prompt}`;
  if (isTranslation) return `Emulated English translation of ${filename}`;
  return `Emulated transcript of ${filename}`;
}

function toSrt(text: string): string {
  return `1\n00:00:00,000 --> 00:00:05,000\n${text}\n`;
}

function toVtt(text: string): string {
  return `WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n${text}\n`;
}

function buildFakeAudio(input: string, format: string): Uint8Array {
  if (format === "wav" || format === "pcm") {
    const samples = Math.min(8000, Math.max(1600, input.length * 40));
    const dataSize = samples * 2;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write("RIFF", 0);
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(16000, 24);
    buf.writeUInt32LE(32000, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36);
    buf.writeUInt32LE(dataSize, 40);
    let state = 0;
    for (let i = 0; i < input.length; i++) state = (state + input.charCodeAt(i) * (i + 1)) >>> 0;
    for (let i = 0; i < samples; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const sample = ((state % 6000) - 3000) | 0;
      buf.writeInt16LE(sample, 44 + i * 2);
    }
    return new Uint8Array(buf);
  }

  // Minimal deterministic fake MPEG frame header + payload
  const payload = Buffer.from(`ID3emulate-openai:${input}`, "utf8");
  const header = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
  return new Uint8Array(Buffer.concat([header, payload]));
}
