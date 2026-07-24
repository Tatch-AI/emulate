import type { RouteContext } from "@emulators/core";
import { getDeepgramStore } from "../store.js";
import {
  buildMpegBytes,
  buildWavBytes,
  deepgramError,
  generateUuid,
  modelInfoFor,
  recordUsage,
  requireDeepgramAuth,
  resolveProjectId,
} from "../helpers.js";

export function speakRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ds = () => getDeepgramStore(store);

  app.post("/v1/speak", async (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const requestId = generateUuid();
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return deepgramError(c, 400, "Bad Request", "Invalid JSON body.", requestId);
    }

    const text = typeof body.text === "string" ? body.text : "";
    if (!text) {
      return deepgramError(c, 400, "Bad Request", "text is required.", requestId);
    }

    const model = c.req.query("model") ?? ds().getDefaultSpeakModel();
    const encoding = (c.req.query("encoding") ?? "linear16").toLowerCase();
    const container = (c.req.query("container") ?? (encoding.includes("mp3") || encoding === "mp3" ? "mp3" : "wav")).toLowerCase();
    const charCount = text.length;
    const modelMeta = modelInfoFor(model);

    const useMp3 = container === "mp3" || encoding === "mp3" || encoding === "mpeg";
    const audio = useMp3 ? buildMpegBytes(charCount) : buildWavBytes(charCount);
    const contentType = useMp3 ? "audio/mpeg" : "audio/wav";

    const projectId = resolveProjectId(ds(), auth.apiKey);
    ds().speakRequests.insert({
      request_id: requestId,
      project_id: projectId,
      model,
      text,
      char_count: charCount,
      encoding,
      container,
      response_code: 200,
      created: new Date().toISOString(),
    });

    recordUsage(ds(), {
      request_id: requestId,
      project_id: projectId,
      path: "/v1/speak",
      code: 200,
      duration_hours: Math.max(charCount / 15, 0.5) / 3600,
      api_key_id: auth.apiKey?.api_key_id ?? null,
    });

    c.header("dg-request-id", requestId);
    c.header("dg-model-name", model);
    c.header("dg-model-uuid", modelMeta.uuid);
    c.header("dg-char-count", String(charCount));

    return c.body(audio, 200, { "Content-Type": contentType });
  });
}
