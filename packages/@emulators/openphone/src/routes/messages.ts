import type { Context, RouteContext } from "@emulators/core";
import { getOpenPhoneStore } from "../store.js";
import {
  conversationIdFor,
  defaultUserId,
  dispatchOpenPhoneEvent,
  formatMessage,
  listEnvelope,
  normalizeE164,
  openPhoneError,
  openPhoneId,
  parseJson,
  parseMaxResults,
  parsePageToken,
  queryParticipants,
  requireOpenPhoneAuth,
  resolvePhoneNumber,
} from "../helpers.js";

export function messageRoutes({ app, store }: RouteContext): void {
  const ops = () => getOpenPhoneStore(store);

  app.post("/v1/messages", async (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const body = await parseJson(c);
    if (body instanceof Response) return body;

    const content = typeof body.content === "string" ? body.content : undefined;
    const from = typeof body.from === "string" ? body.from : undefined;
    const toRaw = body.to;
    const userId = typeof body.userId === "string" ? body.userId : undefined;

    const fieldErrors: Array<{ path: string; message: string; value?: unknown }> = [];
    if (!content || !content.trim()) {
      fieldErrors.push({ path: "content", message: "content is required", value: content });
    }
    if (!from) {
      fieldErrors.push({ path: "from", message: "from is required", value: from });
    }
    if (!Array.isArray(toRaw) || toRaw.length === 0) {
      fieldErrors.push({ path: "to", message: "to must be a non-empty array of E.164 numbers", value: toRaw });
    }
    if (fieldErrors.length > 0) {
      return openPhoneError(c, 400, "Validation Error", "Invalid request body", "validation", fieldErrors);
    }

    const to = (toRaw as unknown[]).map(String);
    const invalidTo = to.filter((number) => !normalizeE164(number));
    if (invalidTo.length > 0) {
      return openPhoneError(c, 400, "Validation Error", "to must contain E.164 phone numbers", "validation", [
        { path: "to", message: "Invalid E.164 number", value: invalidTo },
      ]);
    }

    const phoneNumber = resolvePhoneNumber(ops(), from!);
    if (!phoneNumber) {
      return openPhoneError(c, 400, "Validation Error", "from must resolve to a workspace phone number", "validation", [
        { path: "from", message: "Unknown phone number", value: from },
      ]);
    }

    const now = new Date().toISOString();
    const message = ops().messages.insert({
      openphone_id: openPhoneId("AC", 20),
      to: to.map((n) => normalizeE164(n)!),
      from: phoneNumber.number,
      text: content!.trim(),
      phone_number_id: phoneNumber.openphone_id,
      conversation_id: conversationIdFor(phoneNumber.openphone_id, to),
      direction: "outgoing",
      user_id: userId ?? defaultUserId(ops()),
      status: "sent",
    });

    const delivered = ops().messages.update(message.id, {
      status: "delivered",
      updated_at: now,
    })!;

    await dispatchOpenPhoneEvent(
      ops(),
      "message.delivered",
      phoneNumber.openphone_id,
      formatMessage(delivered),
      ["messages"],
    );

    return c.json({ data: formatMessage(delivered) }, 201);
  });

  app.get("/v1/messages", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;

    const phoneNumberId = c.req.query("phoneNumberId");
    const participants = queryParticipants(c);
    if (!phoneNumberId) {
      return openPhoneError(c, 400, "Validation Error", "phoneNumberId is required", "validation", [
        { path: "phoneNumberId", message: "Required" },
      ]);
    }
    if (participants.length === 0) {
      return openPhoneError(c, 400, "Validation Error", "participants is required", "validation", [
        { path: "participants", message: "Required" },
      ]);
    }

    const userId = c.req.query("userId");
    const createdAfter = c.req.query("createdAfter");
    const createdBefore = c.req.query("createdBefore");
    const maxResults = parseMaxResults(c);
    const offset = parsePageToken(c);

    let messages = ops()
      .messages.all()
      .filter((message) => message.phone_number_id === phoneNumberId)
      .filter((message) => participants.every((participant) => message.to.includes(participant) || message.from === participant));

    if (userId) messages = messages.filter((message) => message.user_id === userId);
    if (createdAfter) messages = messages.filter((message) => message.created_at >= createdAfter);
    if (createdBefore) messages = messages.filter((message) => message.created_at < createdBefore);

    messages = messages.sort((a, b) => b.id - a.id);
    const envelope = listEnvelope(messages.map(formatMessage), maxResults, offset);
    return c.json(envelope);
  });

  app.get("/v1/messages/:id", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const message = findMessage(c);
    if (message instanceof Response) return message;
    return c.json({ data: formatMessage(message) });
  });

  function findMessage(c: Context) {
    const message = ops().messages.findOneBy("openphone_id", c.req.param("id"));
    if (!message) return openPhoneError(c, 404, "Not Found", "Message not found", "not_found");
    return message;
  }
}
