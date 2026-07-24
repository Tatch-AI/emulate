import type { RouteContext } from "@emulators/core";
import { getDeepgramStore } from "../store.js";
import {
  DEFAULT_SUMMARY,
  deepgramError,
  detectIntents,
  detectSentiment,
  detectTopics,
  generateUuid,
  matchTranscript,
  modelUuid,
  queryBool,
  recordUsage,
  requireDeepgramAuth,
  resolveProjectId,
} from "../helpers.js";

export function readRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ds = () => getDeepgramStore(store);

  app.post("/v1/read", async (c) => {
    const auth = requireDeepgramAuth(c, ds());
    if (auth instanceof Response) return auth;

    const requestId = generateUuid();
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return deepgramError(c, 400, "Bad Request", "Invalid JSON body.", requestId);
    }

    const text = typeof body.text === "string" ? body.text : null;
    const url = typeof body.url === "string" ? body.url : null;
    if (!text && !url) {
      return deepgramError(c, 400, "Bad Request", "text or url is required.", requestId);
    }

    const language = c.req.query("language") ?? "en";
    const summarize = queryBool(c, "summarize");
    const topics = queryBool(c, "topics");
    const sentiment = queryBool(c, "sentiment");
    const intents = queryBool(c, "intents");

    const sourceText = text ?? `Content from ${url}`;
    const matcher = matchTranscript(ds().getReadMatchers().length ? ds().getReadMatchers() : ds().getTranscriptMatchers(), {
      url,
      text: sourceText,
    });

    const results: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = {
      request_id: requestId,
      created: new Date().toISOString(),
      language,
    };

    if (summarize) {
      results.summary = { text: matcher.summary ?? matcher.text ?? DEFAULT_SUMMARY };
      metadata.summary_info = { model_uuid: modelUuid("summarize"), input_tokens: sourceText.split(/\s+/).length, output_tokens: 24 };
    }
    if (topics) {
      results.topics = {
        segments: [
          {
            text: sourceText,
            start_word: 0,
            end_word: Math.max(sourceText.split(/\s+/).length - 1, 0),
            topics: detectTopics(sourceText),
          },
        ],
      };
      metadata.topics_info = { model_uuid: modelUuid("topics"), input_tokens: sourceText.split(/\s+/).length, output_tokens: 12 };
    }
    if (sentiment) {
      const avg = detectSentiment(sourceText);
      results.sentiments = {
        segments: [
          {
            text: sourceText,
            start_word: 0,
            end_word: Math.max(sourceText.split(/\s+/).length - 1, 0),
            sentiment: avg.sentiment,
            sentiment_score: avg.sentiment_score,
          },
        ],
        average: avg,
      };
      // Alias for callers expecting singular key from older docs
      results.sentiment = results.sentiments;
      metadata.sentiment_info = { model_uuid: modelUuid("sentiment"), input_tokens: sourceText.split(/\s+/).length, output_tokens: 8 };
    }
    if (intents) {
      results.intents = {
        segments: [
          {
            text: sourceText,
            intents: detectIntents(sourceText),
          },
        ],
      };
      metadata.intents_info = { model_uuid: modelUuid("intents"), input_tokens: sourceText.split(/\s+/).length, output_tokens: 8 };
    }

    const projectId = resolveProjectId(ds(), auth.apiKey);
    ds().readRequests.insert({
      request_id: requestId,
      project_id: projectId,
      text_preview: sourceText.slice(0, 120),
      source: url ? "url" : "text",
      features: { language, summarize, topics, sentiment, intents },
      response_code: 200,
      created: new Date().toISOString(),
    });

    recordUsage(ds(), {
      request_id: requestId,
      project_id: projectId,
      path: "/v1/read",
      code: 200,
      duration_hours: 0,
      api_key_id: auth.apiKey?.api_key_id ?? null,
    });

    return c.json({ metadata, results }, 200);
  });
}
