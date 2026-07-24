import type { Context, RouteContext } from "@emulators/core";
import { getOpenPhoneStore } from "../store.js";
import {
  formatCall,
  formatRecording,
  formatSummary,
  formatTranscript,
  listEnvelope,
  openPhoneError,
  parseMaxResults,
  parsePageToken,
  queryParticipants,
  requireOpenPhoneAuth,
} from "../helpers.js";

export function callRoutes({ app, store }: RouteContext): void {
  const ops = () => getOpenPhoneStore(store);

  app.get("/v1/calls", (c) => {
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

    let calls = ops()
      .calls.all()
      .filter((call) => call.phone_number_id === phoneNumberId)
      .filter((call) => participants.every((participant) => call.participants.includes(participant)));

    if (userId) calls = calls.filter((call) => call.user_id === userId);
    if (createdAfter) calls = calls.filter((call) => call.created_at >= createdAfter);
    if (createdBefore) calls = calls.filter((call) => call.created_at < createdBefore);

    calls = calls.sort((a, b) => b.id - a.id);
    return c.json(listEnvelope(calls.map(formatCall), maxResults, offset));
  });

  app.get("/v1/calls/:callId", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const call = findCall(c);
    if (call instanceof Response) return call;
    return c.json({ data: formatCall(call) });
  });

  app.get("/v1/call-recordings/:callId", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const call = findCall(c);
    if (call instanceof Response) return call;
    const recordings = ops()
      .recordings.findBy("call_id", call.openphone_id)
      .map(formatRecording);
    return c.json({ data: recordings });
  });

  // Alias matching the nested path shape used in some client docs.
  app.get("/v1/calls/:callId/recordings", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const call = findCall(c);
    if (call instanceof Response) return call;
    const recordings = ops()
      .recordings.findBy("call_id", call.openphone_id)
      .map(formatRecording);
    return c.json({ data: recordings });
  });

  app.get("/v1/call-summaries/:callId", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const call = findCall(c);
    if (call instanceof Response) return call;
    const summary = ops().summaries.findOneBy("call_id", call.openphone_id);
    if (!summary) return openPhoneError(c, 404, "Not Found", "Call summary not found", "not_found");
    return c.json({ data: formatSummary(summary) });
  });

  app.get("/v1/call-transcripts/:callId", (c) => {
    const auth = requireOpenPhoneAuth(c, ops());
    if (auth instanceof Response) return auth;
    const callId = c.req.param("callId");
    const call = ops().calls.findOneBy("openphone_id", callId);
    if (!call) return openPhoneError(c, 404, "Not Found", "Call not found", "not_found");
    const transcript = ops().transcripts.findOneBy("call_id", call.openphone_id);
    if (!transcript) return openPhoneError(c, 404, "Not Found", "Call transcript not found", "not_found");
    return c.json({ data: formatTranscript(transcript) });
  });

  function findCall(c: Context) {
    const callId = c.req.param("callId");
    const call = ops().calls.findOneBy("openphone_id", callId);
    if (!call) return openPhoneError(c, 404, "Not Found", "Call not found", "not_found");
    return call;
  }
}
