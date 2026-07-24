import type { Context, RouteContext } from "@emulators/core";
import type { OpenPhoneWebhookType } from "../entities.js";
import { getOpenPhoneStore } from "../store.js";
import {
  DEFAULT_ORG_ID,
  defaultUserId,
  formatWebhook,
  generateWebhookKey,
  openPhoneError,
  openPhoneId,
  parseJson,
  requireOpenPhoneAuth,
} from "../helpers.js";

const MESSAGE_EVENTS = new Set(["message.received", "message.delivered"]);
const CALL_EVENTS = new Set(["call.completed", "call.ringing", "call.recording.completed"]);
const SUMMARY_EVENTS = new Set(["call.summary.completed"]);
const TRANSCRIPT_EVENTS = new Set(["call.transcript.completed"]);

export function webhookRoutes({ app, store }: RouteContext): void {
  const ops = () => getOpenPhoneStore(store);

  app.post("/v1/webhooks/messages", async (c) => createWebhook(c, "messages", MESSAGE_EVENTS));
  app.post("/v1/webhooks/calls", async (c) => createWebhook(c, "calls", CALL_EVENTS));
  app.post("/v1/webhooks/call-summaries", async (c) => createWebhook(c, "call-summaries", SUMMARY_EVENTS));
  app.post("/v1/webhooks/call-transcripts", async (c) => createWebhook(c, "call-transcripts", TRANSCRIPT_EVENTS));

  app.get("/v1/webhooks", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const hooks = ops()
      .webhooks.all()
      .filter((hook) => !hook.deleted_at)
      .sort((a, b) => b.id - a.id)
      .map(formatWebhook);
    return c.json({ data: hooks });
  });

  app.get("/v1/webhooks/:id", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const hook = findWebhook(c);
    if (hook instanceof Response) return hook;
    return c.json({ data: formatWebhook(hook) });
  });

  app.delete("/v1/webhooks/:id", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const hook = findWebhook(c);
    if (hook instanceof Response) return hook;
    ops().webhooks.delete(hook.id);
    return c.body(null, 204);
  });

  async function createWebhook(c: Context, type: OpenPhoneWebhookType, allowed: Set<string>) {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const body = await parseJson(c);
    if (body instanceof Response) return body;

    const url = typeof body.url === "string" ? body.url : undefined;
    const events = Array.isArray(body.events) ? body.events.map(String) : [];
    const fieldErrors: Array<{ path: string; message: string; value?: unknown }> = [];
    if (!url) fieldErrors.push({ path: "url", message: "url is required", value: url });
    if (events.length === 0) fieldErrors.push({ path: "events", message: "events is required", value: body.events });
    const invalidEvents = events.filter((event) => !allowed.has(event));
    if (invalidEvents.length > 0) {
      fieldErrors.push({ path: "events", message: "Unsupported event type", value: invalidEvents });
    }
    if (fieldErrors.length > 0) {
      return openPhoneError(c, 400, "Validation Error", "Invalid webhook request", "validation", fieldErrors);
    }

    const resourceIds = Array.isArray(body.resourceIds)
      ? body.resourceIds.map(String)
      : (["*"] as string[]);
    const status = body.status === "disabled" ? "disabled" : "enabled";
    const userId = typeof body.userId === "string" ? body.userId : defaultUserId(ops());
    const key = typeof body.key === "string" ? body.key : generateWebhookKey();

    const hook = ops().webhooks.insert({
      openphone_id: openPhoneId("WH", 12),
      user_id: userId,
      org_id: DEFAULT_ORG_ID,
      label: typeof body.label === "string" ? body.label : null,
      status,
      url: url!,
      key,
      events,
      resource_ids: resourceIds,
      webhook_type: type,
      deleted_at: null,
    });

    return c.json({ data: formatWebhook(hook) }, 201);
  }

  function findWebhook(c: Context) {
    const hook = ops().webhooks.findOneBy("openphone_id", c.req.param("id"));
    if (!hook || hook.deleted_at) return openPhoneError(c, 404, "Not Found", "Webhook not found", "not_found");
    return hook;
  }
}
