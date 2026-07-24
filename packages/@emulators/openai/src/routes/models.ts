import type { RouteContext } from "@emulators/core";
import { getOpenAIStore } from "../store.js";
import { applyOpenAIHeaders, openaiError, requireOpenAIAuth } from "../helpers.js";

export function modelRoutes({ app, store }: RouteContext): void {
  const os = () => getOpenAIStore(store);

  app.get("/v1/models", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const data = os()
      .models.all()
      .map((m) => ({
        id: m.model_id,
        object: "model" as const,
        created: m.created,
        owned_by: m.owned_by,
      }));

    return c.json({ object: "list", data });
  });

  app.get("/v1/models/:id", (c) => {
    const auth = requireOpenAIAuth(c, os());
    if (auth !== true) return auth;
    applyOpenAIHeaders(c);

    const model = os().models.findOneBy("model_id", c.req.param("id"));
    if (!model) {
      return openaiError(
        c,
        404,
        `The model '${c.req.param("id")}' does not exist`,
        "invalid_request_error",
        "model_not_found",
        null,
      );
    }
    return c.json({
      id: model.model_id,
      object: "model",
      created: model.created,
      owned_by: model.owned_by,
    });
  });
}
