import type { RouteContext } from "@emulators/core";
import { getOpenAIStore } from "../store.js";
import {
  applyOpenAIHeaders,
  estimateTokens,
  extractInputText,
  logRequest,
  openaiError,
  parseJsonBody,
  requireOpenAIAuth,
} from "../helpers.js";

const CATEGORIES = [
  "hate",
  "hate/threatening",
  "harassment",
  "harassment/threatening",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "sexual",
  "sexual/minors",
  "violence",
  "violence/graphic",
] as const;

export function moderationRoutes({ app, store }: RouteContext): void {
  const os = () => getOpenAIStore(store);

  app.post("/v1/moderations", async (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    const rid = applyOpenAIHeaders(c);

    const bodyOrErr = await parseJsonBody(c);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const model = (body.model as string | undefined) ?? "omni-moderation-latest";
    if (body.input === undefined || body.input === null) {
      return openaiError(c, 400, "Missing required parameter: 'input'", "invalid_request_error", null, "input");
    }

    const inputs = Array.isArray(body.input)
      ? body.input.map((item) => (typeof item === "string" ? item : extractInputText(item)))
      : [typeof body.input === "string" ? body.input : extractInputText(body.input)];

    const triggers = os().moderationTriggers.all();
    const results = inputs.map((text) => {
      const flaggedCategories = new Set<string>();
      for (const trigger of triggers) {
        if (text.toLowerCase().includes(trigger.contains.toLowerCase())) {
          for (const cat of trigger.categories.length ? trigger.categories : ["hate", "violence"]) {
            flaggedCategories.add(cat);
          }
        }
      }

      const categories: Record<string, boolean> = {};
      const categoryScores: Record<string, number> = {};
      const categoryAppliedInputTypes: Record<string, string[]> = {};
      for (const cat of CATEGORIES) {
        const flagged = flaggedCategories.has(cat);
        categories[cat] = flagged;
        categoryScores[cat] = flagged ? 0.95 : 0.0001;
        categoryAppliedInputTypes[cat] = ["text"];
      }

      return {
        flagged: flaggedCategories.size > 0,
        categories,
        category_scores: categoryScores,
        category_applied_input_types: categoryAppliedInputTypes,
      };
    });

    logRequest(os(), {
      request_id: rid,
      method: "POST",
      path: "/v1/moderations",
      model,
      prompt_preview: inputs[0] ?? "",
      reply_preview: results.some((r) => r.flagged) ? "flagged" : "clean",
      prompt_tokens: estimateTokens(inputs.join("\n")),
      completion_tokens: 0,
      streamed: false,
    });

    return c.json({
      id: `modr_${Date.now().toString(36)}`,
      model,
      results,
    });
  });
}
