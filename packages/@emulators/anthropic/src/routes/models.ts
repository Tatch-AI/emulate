import type { RouteContext } from "@emulators/core";
import { getAnthropicStore } from "../store.js";
import { anthropicError, paginateById, withRequestId } from "../helpers.js";
import type { AnthropicModel } from "../entities.js";

function formatModel(model: AnthropicModel) {
  return {
    id: model.model_id,
    type: "model" as const,
    display_name: model.display_name,
    created_at: model.created_at_iso,
  };
}

export function listCanonicalModels(store: RouteContext["store"]): ReturnType<typeof formatModel>[] {
  return getAnthropicStore(store)
    .models.all()
    .filter((m) => !m.alias_of)
    .sort((a, b) => (a.created_at_iso < b.created_at_iso ? 1 : a.created_at_iso > b.created_at_iso ? -1 : 0))
    .map(formatModel);
}

export function modelRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;

  app.get("/v1/models", (c) => {
    withRequestId(c);
    const items = listCanonicalModels(store);
    const page = paginateById(items, {
      before_id: c.req.query("before_id"),
      after_id: c.req.query("after_id"),
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : 20,
    });
    return c.json(page);
  });

  app.get("/v1/models/:id", (c) => {
    withRequestId(c);
    const id = c.req.param("id");
    const as = getAnthropicStore(store);
    const direct = as.models.findOneBy("model_id", id);
    if (!direct) {
      return anthropicError(c, 404, "not_found_error", `model: ${id}`);
    }
    if (direct.alias_of) {
      const target = as.models.findOneBy("model_id", direct.alias_of);
      if (!target) {
        return anthropicError(c, 404, "not_found_error", `model: ${id}`);
      }
      return c.json(formatModel(target));
    }
    return c.json(formatModel(direct));
  });
}
