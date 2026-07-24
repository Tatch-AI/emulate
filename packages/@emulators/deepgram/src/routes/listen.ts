import type { RouteContext } from "@emulators/core";
import { getDeepgramStore } from "../store.js";
import {
  buildParagraphs,
  buildUtterances,
  buildWords,
  deepgramError,
  dispatchCallback,
  generateUuid,
  matchTranscript,
  modelInfoFor,
  queryBool,
  queryInt,
  recordUsage,
  requireDeepgramAuth,
  resolveProjectId,
  sha256Hex,
} from "../helpers.js";

export function listenRoutes(ctx: RouteContext): void {
  const { app, store, webhooks } = ctx;
  const ds = () => getDeepgramStore(store);

  app.post("/v1/listen", async (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const requestId = generateUuid();
    const model = c.req.query("model") ?? "nova-3";
    const language = c.req.query("language") ?? "en";
    const detectLanguage = queryBool(c, "detect_language");
    const smartFormat = queryBool(c, "smart_format");
    const punctuate = queryBool(c, "punctuate") || smartFormat;
    const paragraphs = queryBool(c, "paragraphs");
    const utterances = queryBool(c, "utterances");
    const diarize = queryBool(c, "diarize");
    const multichannel = queryBool(c, "multichannel");
    const channelsParam = queryInt(c, "channels");
    const channelCount = multichannel ? Math.max(channelsParam ?? 2, 2) : Math.max(channelsParam ?? 1, 1);
    const summarize = c.req.query("summarize");
    const topics = queryBool(c, "topics");
    const intents = queryBool(c, "intents");
    const sentiment = queryBool(c, "sentiment");
    const callback = c.req.query("callback") ?? null;
    const keywords = c.req.query("keywords");
    const search = c.req.query("search");
    const redact = c.req.query("redact");
    const fillerWords = queryBool(c, "filler_words");

    const contentType = (c.req.header("Content-Type") ?? "").toLowerCase();
    const rawBuffer = new Uint8Array(await c.req.arrayBuffer());

    let sourceUrl: string | null = null;
    let source = "binary";
    let bodyHashInput: string | Uint8Array = rawBuffer;

    const isJson =
      contentType.includes("application/json") ||
      (rawBuffer.length > 0 && rawBuffer[0] === 0x7b); /* '{' */

    if (isJson) {
      const text = Buffer.from(rawBuffer).toString("utf8");
      bodyHashInput = text;
      if (!text.trim()) {
        return deepgramError(c, 400, "Bad Request", "Request body must include a url field.", requestId);
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        return deepgramError(c, 400, "Bad Request", "Invalid JSON body.", requestId);
      }
      if (typeof body.url === "string" && body.url) {
        sourceUrl = body.url;
        source = "url";
      } else {
        return deepgramError(c, 400, "Bad Request", "Request body must include a url field.", requestId);
      }
    } else if (rawBuffer.length === 0) {
      return deepgramError(c, 400, "Bad Request", "Request body is required.", requestId);
    }

    const matcher = matchTranscript(ds().getTranscriptMatchers(), {
      url: sourceUrl,
      binary: source === "binary",
    });
    const duration = matcher.duration ?? Math.max(1, matcher.text.split(/\s+/).length * 0.35);
    const speakers = matcher.speakers ?? 1;
    const { displayTranscript, words } = buildWords(matcher.text, duration, {
      punctuate,
      diarize,
      speakers,
    });

    const modelMeta = modelInfoFor(model);
    const alternative: Record<string, unknown> = {
      transcript: displayTranscript,
      confidence: 0.99,
      words,
    };

    const utts = utterances || paragraphs || diarize ? buildUtterances(words, matcher.text, diarize) : [];
    if (paragraphs) {
      alternative.paragraphs = buildParagraphs(utts, displayTranscript);
    }

    const channelBase: Record<string, unknown> = {
      alternatives: [alternative],
    };
    if (detectLanguage) {
      channelBase.detected_language = language || "en";
      channelBase.language_confidence = 0.98;
    }

    const channels = Array.from({ length: channelCount }, () => ({
      ...channelBase,
      alternatives: [{ ...alternative, words: words.map((w) => ({ ...w })) }],
    }));

    const results: Record<string, unknown> = { channels };
    if (utterances) {
      results.utterances = utts;
    }
    if (summarize === "v2" || summarize === "true") {
      results.summary = {
        result: "success",
        short: matcher.summary ?? `Summary: ${displayTranscript.slice(0, 120)}`,
      };
    }
    if (topics) {
      results.topics = {
        segments: [
          {
            text: displayTranscript,
            start_word: 0,
            end_word: Math.max(words.length - 1, 0),
            topics: [{ topic: "General", confidence_score: 0.8 }],
          },
        ],
      };
    }
    if (intents) {
      results.intents = {
        segments: [
          {
            text: displayTranscript,
            intents: [{ intent: "Inform", confidence_score: 0.75 }],
          },
        ],
      };
    }
    if (sentiment) {
      results.sentiments = {
        segments: [
          {
            text: displayTranscript,
            start_word: 0,
            end_word: Math.max(words.length - 1, 0),
            sentiment: "neutral",
            sentiment_score: 0.05,
          },
        ],
        average: { sentiment: "neutral", sentiment_score: 0.05 },
      };
    }

    const responseBody = {
      metadata: {
        transaction_key: "deprecated",
        request_id: requestId,
        sha256: sha256Hex(bodyHashInput),
        created: new Date().toISOString(),
        duration,
        channels: channelCount,
        models: [modelMeta.uuid],
        model_info: modelMeta.info,
      },
      results,
    };

    const projectId = resolveProjectId(ds(), auth.apiKey);
    const features = {
      model,
      language,
      detect_language: detectLanguage,
      smart_format: smartFormat,
      punctuate,
      paragraphs,
      utterances,
      diarize,
      multichannel,
      channels: channelCount,
      keywords,
      search,
      redact,
      filler_words: fillerWords,
      summarize,
      topics,
      intents,
      sentiment,
    };

    ds().listenRequests.insert({
      request_id: requestId,
      project_id: projectId,
      model,
      source,
      source_url: sourceUrl,
      transcript: displayTranscript,
      duration,
      features,
      response_code: 200,
      callback,
      created: new Date().toISOString(),
    });

    recordUsage(ds(), {
      request_id: requestId,
      project_id: projectId,
      path: "/v1/listen",
      code: 200,
      duration_hours: duration / 3600,
      api_key_id: auth.apiKey?.api_key_id ?? null,
    });

    if (callback) {
      const dgToken = generateUuid();
      void dispatchCallback(ds(), webhooks, {
        url: callback,
        request_id: requestId,
        payload: responseBody,
        dgToken,
      });
      return c.json({ request_id: requestId }, 200);
    }

    return c.json(responseBody, 200);
  });
}
