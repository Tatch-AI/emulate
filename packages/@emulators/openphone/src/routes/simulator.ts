import type { RouteContext } from "@emulators/core";
import type { OpenPhoneCallStatus, OpenPhoneDialogueLine } from "../entities.js";
import { getOpenPhoneStore } from "../store.js";
import {
  conversationIdFor,
  defaultUserId,
  dispatchOpenPhoneEvent,
  formatCall,
  formatMessage,
  formatRecording,
  formatSummary,
  formatTranscript,
  normalizeE164,
  openPhoneError,
  openPhoneId,
  parseJson,
  requireOpenPhoneAuth,
  resolvePhoneNumber,
} from "../helpers.js";

export function simulatorRoutes({ app, store, baseUrl }: RouteContext): void {
  const ops = () => getOpenPhoneStore(store);

  app.post("/_openphone/simulate/inbound-message", async (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const body = await parseJson(c);
    if (body instanceof Response) return body;

    const to = typeof body.to === "string" ? body.to : undefined;
    const from = typeof body.from === "string" ? body.from : undefined;
    const text = typeof body.body === "string" ? body.body : typeof body.content === "string" ? body.content : "";
    if (!to || !from) {
      return openPhoneError(c, 400, "Validation Error", "to and from are required", "validation");
    }

    const phoneNumber = resolvePhoneNumber(ops(), to);
    if (!phoneNumber) return openPhoneError(c, 404, "Not Found", "Phone number was not found", "not_found");
    const fromE164 = normalizeE164(from);
    if (!fromE164) {
      return openPhoneError(c, 400, "Validation Error", "from must be E.164", "validation", [
        { path: "from", message: "Invalid E.164 number", value: from },
      ]);
    }

    const message = ops().messages.insert({
      openphone_id: openPhoneId("AC", 20),
      to: [phoneNumber.number],
      from: fromE164,
      text,
      phone_number_id: phoneNumber.openphone_id,
      conversation_id: conversationIdFor(phoneNumber.openphone_id, [fromE164]),
      direction: "incoming",
      user_id: null,
      status: "received",
    });

    await dispatchOpenPhoneEvent(
      ops(),
      "message.received",
      phoneNumber.openphone_id,
      formatMessage(message),
      ["messages"],
    );

    return c.json({ data: formatMessage(message) }, 201);
  });

  app.post("/_openphone/simulate/inbound-call", async (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const body = await parseJson(c);
    if (body instanceof Response) return body;

    const to = typeof body.to === "string" ? body.to : undefined;
    const from = typeof body.from === "string" ? body.from : undefined;
    if (!to || !from) {
      return openPhoneError(c, 400, "Validation Error", "to and from are required", "validation");
    }

    const phoneNumber = resolvePhoneNumber(ops(), to);
    if (!phoneNumber) return openPhoneError(c, 404, "Not Found", "Phone number was not found", "not_found");
    const fromE164 = normalizeE164(from);
    if (!fromE164) {
      return openPhoneError(c, 400, "Validation Error", "from must be E.164", "validation");
    }

    const answered = body.answered !== false;
    const duration = typeof body.duration === "number" ? body.duration : answered ? 30 : 0;
    const status: OpenPhoneCallStatus =
      typeof body.status === "string" && ["completed", "missed", "no-answer"].includes(body.status)
        ? (body.status as OpenPhoneCallStatus)
        : answered
          ? "completed"
          : "missed";
    const now = new Date().toISOString();

    const call = ops().calls.insert({
      openphone_id: openPhoneId("AC", 20),
      phone_number_id: phoneNumber.openphone_id,
      user_id: defaultUserId(ops()),
      direction: "incoming",
      participants: [fromE164],
      status: "ringing",
      answered_at: null,
      answered_by: null,
      initiated_by: null,
      completed_at: null,
      duration: 0,
      voicemail: null,
      call_route: null,
      forwarded_from: null,
      forwarded_to: null,
      ai_handled: false,
    });

    await dispatchOpenPhoneEvent(ops(), "call.ringing", phoneNumber.openphone_id, formatCall(call), ["calls"]);

    const completed = ops().calls.update(call.id, {
      status,
      answered_at: answered ? now : null,
      answered_by: answered ? defaultUserId(ops()) : null,
      completed_at: now,
      duration,
    })!;

    await dispatchOpenPhoneEvent(ops(), "call.completed", phoneNumber.openphone_id, formatCall(completed), ["calls"]);

    return c.json({ data: formatCall(completed) }, 201);
  });

  app.post("/_openphone/simulate/call-recording", async (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const body = await parseJson(c);
    if (body instanceof Response) return body;

    const callId = typeof body.callId === "string" ? body.callId : undefined;
    if (!callId) return openPhoneError(c, 400, "Validation Error", "callId is required", "validation");
    const call = ops().calls.findOneBy("openphone_id", callId);
    if (!call) return openPhoneError(c, 404, "Not Found", "Call not found", "not_found");

    const duration = typeof body.duration === "number" ? body.duration : call.duration || 30;
    const url =
      typeof body.url === "string"
        ? body.url
        : `${baseUrl}/_openphone/recordings/${call.openphone_id}.mp3`;

    const recording = ops().recordings.insert({
      openphone_id: openPhoneId("CR", 10),
      call_id: call.openphone_id,
      url,
      duration,
      type: "audio/mpeg",
      start_time: call.answered_at ?? call.created_at,
      status: "completed",
    });

    const object = {
      ...formatRecording(recording),
      callId: call.openphone_id,
    };
    await dispatchOpenPhoneEvent(ops(), "call.recording.completed", call.phone_number_id, object, ["calls"]);

    return c.json({ data: formatRecording(recording) }, 201);
  });

  app.post("/_openphone/simulate/call-summary", async (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const body = await parseJson(c);
    if (body instanceof Response) return body;

    const callId = typeof body.callId === "string" ? body.callId : undefined;
    if (!callId) return openPhoneError(c, 400, "Validation Error", "callId is required", "validation");
    const call = ops().calls.findOneBy("openphone_id", callId);
    if (!call) return openPhoneError(c, 404, "Not Found", "Call not found", "not_found");

    const summaryText = Array.isArray(body.summary) ? body.summary.map(String) : ["Call completed."];
    const nextSteps = Array.isArray(body.nextSteps) ? body.nextSteps.map(String) : [];

    const existing = ops().summaries.findOneBy("call_id", call.openphone_id);
    const summary = existing
      ? ops().summaries.update(existing.id, {
          summary: summaryText,
          next_steps: nextSteps,
          status: "completed",
        })!
      : ops().summaries.insert({
          call_id: call.openphone_id,
          summary: summaryText,
          next_steps: nextSteps,
          status: "completed",
        });

    await dispatchOpenPhoneEvent(
      ops(),
      "call.summary.completed",
      call.phone_number_id,
      formatSummary(summary),
      ["call-summaries"],
    );

    return c.json({ data: formatSummary(summary) }, 201);
  });

  app.post("/_openphone/simulate/call-transcript", async (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const body = await parseJson(c);
    if (body instanceof Response) return body;

    const callId = typeof body.callId === "string" ? body.callId : undefined;
    if (!callId) return openPhoneError(c, 400, "Validation Error", "callId is required", "validation");
    const call = ops().calls.findOneBy("openphone_id", callId);
    if (!call) return openPhoneError(c, 404, "Not Found", "Call not found", "not_found");

    const dialogue: OpenPhoneDialogueLine[] = Array.isArray(body.dialogue)
      ? body.dialogue.map((item) => {
          const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          return {
            content: typeof row.content === "string" ? row.content : "",
            start: typeof row.start === "number" ? row.start : 0,
            end: typeof row.end === "number" ? row.end : 1,
            identifier: typeof row.identifier === "string" ? row.identifier : call.participants[0] ?? "",
            user_id: typeof row.userId === "string" ? row.userId : null,
          };
        })
      : [
          {
            content: "Hello",
            start: 0,
            end: 1,
            identifier: call.participants[0] ?? "",
            user_id: null,
          },
        ];

    const existing = ops().transcripts.findOneBy("call_id", call.openphone_id);
    const transcript = existing
      ? ops().transcripts.update(existing.id, {
          dialogue,
          duration: call.duration,
          status: "completed",
        })!
      : ops().transcripts.insert({
          call_id: call.openphone_id,
          duration: call.duration,
          status: "completed",
          dialogue,
        });

    await dispatchOpenPhoneEvent(
      ops(),
      "call.transcript.completed",
      call.phone_number_id,
      formatTranscript(transcript),
      ["call-transcripts"],
    );

    return c.json({ data: formatTranscript(transcript) }, 201);
  });
}
