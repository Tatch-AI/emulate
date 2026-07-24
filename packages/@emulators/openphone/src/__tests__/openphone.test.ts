import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_API_KEY,
  DEFAULT_PHONE_NUMBER,
  DEFAULT_PHONE_NUMBER_ID,
  DEFAULT_USER_EMAIL,
  DEFAULT_USER_ID,
  getOpenPhoneStore,
  seedFromConfig,
  signOpenPhoneWebhook,
  verifyOpenPhoneSignature,
} from "../index.js";
import { authHeaders, createOpenPhoneTestApp, jsonBody } from "./helpers.js";

interface CapturedDelivery {
  headers: Record<string, string>;
  body: string;
  path: string;
}

function startCaptureServer(): Promise<{
  url: string;
  deliveries: CapturedDelivery[];
  close: () => Promise<void>;
}> {
  const deliveries: CapturedDelivery[] = [];
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString("utf8");
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers[key] = value;
      else if (Array.isArray(value)) headers[key] = value.join(",");
    }
    deliveries.push({ headers, body, path: req.url ?? "/" });
    res.statusCode = 200;
    res.end("ok");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Failed to bind capture server");
      resolve({
        url: `http://127.0.0.1:${address.port}/hook`,
        deliveries,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
}

describe("OpenPhone emulator", () => {
  let setup: ReturnType<typeof createOpenPhoneTestApp>;

  beforeEach(() => {
    setup = createOpenPhoneTestApp();
    vi.restoreAllMocks();
  });

  it("accepts raw Authorization API keys and Bearer keys", async () => {
    const missing = await setup.app.request("http://localhost/v1/phone-numbers");
    expect(missing.status).toBe(401);
    const missingBody = (await missing.json()) as any;
    expect(missingBody).toMatchObject({
      status: 401,
      code: "unauthorized",
      docs: "https://www.openphone.com/docs",
      title: "Unauthorized",
    });

    const raw = await setup.app.request("http://localhost/v1/phone-numbers", {
      headers: authHeaders(DEFAULT_API_KEY, false),
    });
    expect(raw.status).toBe(200);

    const bearer = await setup.app.request("http://localhost/v1/phone-numbers", {
      headers: authHeaders(DEFAULT_API_KEY, true),
    });
    expect(bearer.status).toBe(200);

    const invalid = await setup.app.request("http://localhost/v1/phone-numbers", {
      headers: authHeaders("wrong_key"),
    });
    expect(invalid.status).toBe(401);
  });

  it("accepts any key when no api keys are seeded", async () => {
    const blank = createOpenPhoneTestApp();
    getOpenPhoneStore(blank.store).apiKeys.clear();
    const res = await blank.app.request("http://localhost/v1/phone-numbers", {
      headers: authHeaders("anything"),
    });
    expect(res.status).toBe(200);
  });

  it("applies seed config idempotently", () => {
    seedFromConfig(setup.store, "http://localhost:4310", {
      api_keys: [{ key: DEFAULT_API_KEY, name: "Custom Key" }],
      users: [
        {
          id: DEFAULT_USER_ID,
          first_name: "Ada",
          last_name: "Lovelace",
          email: DEFAULT_USER_EMAIL,
          role: "owner",
        },
      ],
      phone_numbers: [
        {
          id: DEFAULT_PHONE_NUMBER_ID,
          number: DEFAULT_PHONE_NUMBER,
          name: "Main Line",
          users: [DEFAULT_USER_EMAIL],
        },
      ],
      custom_fields: [{ key: "lead-score", name: "Lead Score", type: "number" }],
      contacts: [
        {
          external_id: "crm-1",
          source: "crm",
          default_fields: { firstName: "Casey", lastName: "Lee" },
        },
      ],
    });
    seedFromConfig(setup.store, "http://localhost:4310", {
      api_keys: [{ key: DEFAULT_API_KEY, name: "Custom Key" }],
      users: [
        {
          id: DEFAULT_USER_ID,
          first_name: "Ada",
          last_name: "Lovelace",
          email: DEFAULT_USER_EMAIL,
          role: "owner",
        },
      ],
      phone_numbers: [
        {
          id: DEFAULT_PHONE_NUMBER_ID,
          number: DEFAULT_PHONE_NUMBER,
          name: "Main Line",
          users: [DEFAULT_USER_EMAIL],
        },
      ],
      contacts: [
        {
          external_id: "crm-1",
          source: "crm",
          default_fields: { firstName: "Casey", lastName: "Lee" },
        },
      ],
    });

    const ops = getOpenPhoneStore(setup.store);
    expect(ops.apiKeys.all()).toHaveLength(1);
    expect(ops.apiKeys.all()[0].name).toBe("Custom Key");
    expect(ops.users.all()).toHaveLength(1);
    expect(ops.users.all()[0].first_name).toBe("Ada");
    expect(ops.phoneNumbers.all()).toHaveLength(1);
    expect(ops.phoneNumbers.all()[0].name).toBe("Main Line");
    expect(ops.contacts.all()).toHaveLength(1);
    expect(ops.customFields.all()).toHaveLength(1);
  });

  it("validates outbound messages and returns OpenPhone error envelopes", async () => {
    const missingContent = await setup.app.request("http://localhost/v1/messages", {
      method: "POST",
      headers: authHeaders(),
      body: jsonBody({ from: DEFAULT_PHONE_NUMBER, to: ["+15550001111"] }),
    });
    expect(missingContent.status).toBe(400);
    const missingBody = (await missingContent.json()) as any;
    expect(missingBody.code).toBe("validation");
    expect(missingBody.errors[0].path).toBe("content");

    const unknownFrom = await setup.app.request("http://localhost/v1/messages", {
      method: "POST",
      headers: authHeaders(),
      body: jsonBody({ content: "Hi", from: "+15559999999", to: ["+15550001111"] }),
    });
    expect(unknownFrom.status).toBe(400);
    const unknownBody = (await unknownFrom.json()) as any;
    expect(unknownBody).toMatchObject({
      status: 400,
      code: "validation",
      docs: "https://www.openphone.com/docs",
      title: "Validation Error",
    });
    expect(unknownBody.errors[0].path).toBe("from");
    expect(getOpenPhoneStore(setup.store).messages.all()).toHaveLength(0);
  });

  it("sends messages as delivered and fires signed message.delivered webhooks", async () => {
    const capture = await startCaptureServer();
    try {
      const createHook = await setup.app.request("http://localhost/v1/webhooks/messages", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({
          url: capture.url,
          events: ["message.delivered", "message.received"],
          resourceIds: ["*"],
          label: "messages",
        }),
      });
      expect(createHook.status).toBe(201);
      const hook = (await createHook.json()) as any;

      const send = await setup.app.request("http://localhost/v1/messages", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({
          content: "Hello from OpenPhone",
          from: DEFAULT_PHONE_NUMBER_ID,
          to: ["+15550001111"],
        }),
      });
      expect(send.status).toBe(201);
      const created = (await send.json()) as any;
      expect(created.data.id).toMatch(/^AC/);
      expect(created.data.status).toBe("delivered");
      expect(created.data.direction).toBe("outgoing");
      expect(created.data.text).toBe("Hello from OpenPhone");
      expect(created.data.phoneNumberId).toBe(DEFAULT_PHONE_NUMBER_ID);

      await vi.waitFor(() => expect(capture.deliveries.length).toBe(1));
      const delivery = capture.deliveries[0];
      const signature = delivery.headers["openphone-signature"];
      expect(signature).toBeTruthy();
      expect(verifyOpenPhoneSignature(signature, delivery.body, hook.data.key)).toBe(true);

      const payload = JSON.parse(delivery.body) as any;
      expect(payload).toMatchObject({
        object: "event",
        apiVersion: "v4",
        type: "message.delivered",
      });
      expect(payload.id).toMatch(/^EV/);
      expect(payload.data.object.id).toBe(created.data.id);

      const recorded = getOpenPhoneStore(setup.store).webhookDeliveries.all()[0];
      expect(recorded.event).toBe("message.delivered");
      expect(recorded.request_headers["openphone-signature"]).toBe(signature);
    } finally {
      await capture.close();
    }
  });

  it("lists messages with participant filters and page tokens", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await setup.app.request("http://localhost/v1/messages", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({
          content: `Message ${i}`,
          from: DEFAULT_PHONE_NUMBER,
          to: ["+15550002222"],
        }),
      });
      expect(res.status).toBe(201);
    }

    const page1 = await setup.app.request(
      `http://localhost/v1/messages?phoneNumberId=${DEFAULT_PHONE_NUMBER_ID}&participants=${encodeURIComponent("+15550002222")}&maxResults=2`,
      { headers: authHeaders() },
    );
    expect(page1.status).toBe(200);
    const first = (await page1.json()) as any;
    expect(first.totalItems).toBe(3);
    expect(first.data).toHaveLength(2);
    expect(first.nextPageToken).toBe("2");

    const page2 = await setup.app.request(
      `http://localhost/v1/messages?phoneNumberId=${DEFAULT_PHONE_NUMBER_ID}&participants=${encodeURIComponent("+15550002222")}&maxResults=2&pageToken=2`,
      { headers: authHeaders() },
    );
    const second = (await page2.json()) as any;
    expect(second.data).toHaveLength(1);
    expect(second.nextPageToken).toBeNull();

    const getOne = await setup.app.request(`http://localhost/v1/messages/${first.data[0].id}`, {
      headers: authHeaders(),
    });
    expect(getOne.status).toBe(200);
    const one = (await getOne.json()) as any;
    expect(one.data.id).toBe(first.data[0].id);

    const missing = await setup.app.request("http://localhost/v1/messages/ACmissing", {
      headers: authHeaders(),
    });
    expect(missing.status).toBe(404);
    const missingBody = (await missing.json()) as any;
    expect(missingBody.code).toBe("not_found");
  });

  it("simulates inbound messages and fires message.received", async () => {
    const capture = await startCaptureServer();
    try {
      await setup.app.request("http://localhost/v1/webhooks/messages", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({
          url: capture.url,
          events: ["message.received"],
          resourceIds: [DEFAULT_PHONE_NUMBER_ID],
        }),
      });

      const inbound = await setup.app.request("http://localhost/_openphone/simulate/inbound-message", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({
          to: DEFAULT_PHONE_NUMBER,
          from: "+15550009999",
          body: "inbound hello",
        }),
      });
      expect(inbound.status).toBe(201);
      const message = (await inbound.json()) as any;
      expect(message.data.direction).toBe("incoming");
      expect(message.data.status).toBe("received");
      expect(message.data.text).toBe("inbound hello");

      await vi.waitFor(() => expect(capture.deliveries.length).toBe(1));
      const payload = JSON.parse(capture.deliveries[0].body) as any;
      expect(payload.type).toBe("message.received");
      expect(payload.data.object.id).toBe(message.data.id);
    } finally {
      await capture.close();
    }
  });

  it("lists and fetches calls plus recordings summaries and transcripts", async () => {
    const capture = await startCaptureServer();
    try {
      await setup.app.request("http://localhost/v1/webhooks/calls", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({
          url: capture.url,
          events: ["call.ringing", "call.completed", "call.recording.completed"],
          resourceIds: ["*"],
        }),
      });
      await setup.app.request("http://localhost/v1/webhooks/call-summaries", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({ url: capture.url, events: ["call.summary.completed"] }),
      });
      await setup.app.request("http://localhost/v1/webhooks/call-transcripts", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({ url: capture.url, events: ["call.transcript.completed"] }),
      });

      const inbound = await setup.app.request("http://localhost/_openphone/simulate/inbound-call", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({
          to: DEFAULT_PHONE_NUMBER,
          from: "+15550003333",
          duration: 42,
          answered: true,
        }),
      });
      expect(inbound.status).toBe(201);
      const call = (await inbound.json()) as any;
      expect(call.data.id).toMatch(/^AC/);
      expect(call.data.status).toBe("completed");
      expect(call.data.duration).toBe(42);

      const list = await setup.app.request(
        `http://localhost/v1/calls?phoneNumberId=${DEFAULT_PHONE_NUMBER_ID}&participants=${encodeURIComponent("+15550003333")}`,
        { headers: authHeaders() },
      );
      const listed = (await list.json()) as any;
      expect(listed.totalItems).toBe(1);
      expect(listed.data[0].id).toBe(call.data.id);

      const get = await setup.app.request(`http://localhost/v1/calls/${call.data.id}`, {
        headers: authHeaders(),
      });
      expect(get.status).toBe(200);

      const recording = await setup.app.request("http://localhost/_openphone/simulate/call-recording", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({ callId: call.data.id, duration: 40 }),
      });
      expect(recording.status).toBe(201);

      const recordings = await setup.app.request(`http://localhost/v1/call-recordings/${call.data.id}`, {
        headers: authHeaders(),
      });
      const recordingBody = (await recordings.json()) as any;
      expect(recordingBody.data).toHaveLength(1);
      expect(recordingBody.data[0].type).toBe("audio/mpeg");
      expect(recordingBody.data[0].status).toBe("completed");

      const nested = await setup.app.request(`http://localhost/v1/calls/${call.data.id}/recordings`, {
        headers: authHeaders(),
      });
      expect(nested.status).toBe(200);

      const summary = await setup.app.request("http://localhost/_openphone/simulate/call-summary", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({
          callId: call.data.id,
          summary: ["Discussed pricing"],
          nextSteps: ["Send proposal"],
        }),
      });
      expect(summary.status).toBe(201);
      const summaryGet = await setup.app.request(`http://localhost/v1/call-summaries/${call.data.id}`, {
        headers: authHeaders(),
      });
      const summaryBody = (await summaryGet.json()) as any;
      expect(summaryBody.data.summary).toEqual(["Discussed pricing"]);
      expect(summaryBody.data.nextSteps).toEqual(["Send proposal"]);

      const transcript = await setup.app.request("http://localhost/_openphone/simulate/call-transcript", {
        method: "POST",
        headers: authHeaders(),
        body: jsonBody({
          callId: call.data.id,
          dialogue: [
            { content: "Hi", start: 0, end: 1, identifier: "+15550003333", userId: null },
            { content: "Hello", start: 1, end: 2, identifier: DEFAULT_PHONE_NUMBER, userId: DEFAULT_USER_ID },
          ],
        }),
      });
      expect(transcript.status).toBe(201);
      const transcriptGet = await setup.app.request(`http://localhost/v1/call-transcripts/${call.data.id}`, {
        headers: authHeaders(),
      });
      const transcriptBody = (await transcriptGet.json()) as any;
      expect(transcriptBody.data.dialogue).toHaveLength(2);

      await vi.waitFor(() => expect(capture.deliveries.length).toBeGreaterThanOrEqual(5));
      const types = capture.deliveries.map((delivery) => JSON.parse(delivery.body).type);
      expect(types).toContain("call.ringing");
      expect(types).toContain("call.completed");
      expect(types).toContain("call.recording.completed");
      expect(types).toContain("call.summary.completed");
      expect(types).toContain("call.transcript.completed");
    } finally {
      await capture.close();
    }
  });

  it("supports contacts CRUD custom fields and filters", async () => {
    const create = await setup.app.request("http://localhost/v1/contacts", {
      method: "POST",
      headers: authHeaders(),
      body: jsonBody({
        externalId: "ext-42",
        source: "crm",
        defaultFields: {
          firstName: "Jordan",
          lastName: "Lee",
          company: "Acme",
          role: "Buyer",
          emails: [{ name: "work", value: "jordan@example.com" }],
          phoneNumbers: [{ name: "mobile", value: "+15550004444" }],
        },
        customFields: [{ key: "lead-score", value: "90" }],
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as any;
    expect(created.data.id).toMatch(/^CN/);
    expect(created.data.externalId).toBe("ext-42");
    expect(created.data.defaultFields.firstName).toBe("Jordan");
    expect(created.data.customFields[0].key).toBe("lead-score");

    const list = await setup.app.request(
      "http://localhost/v1/contacts?externalIds=ext-42&sources=crm&maxResults=10",
      { headers: authHeaders() },
    );
    const listed = (await list.json()) as any;
    expect(listed.totalItems).toBe(1);
    expect(listed.data[0].id).toBe(created.data.id);

    const patch = await setup.app.request(`http://localhost/v1/contacts/${created.data.id}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: jsonBody({ defaultFields: { firstName: "Alex" } }),
    });
    const patched = (await patch.json()) as any;
    expect(patched.data.defaultFields.firstName).toBe("Alex");
    expect(patched.data.defaultFields.lastName).toBe("Lee");

    const customFields = await setup.app.request("http://localhost/v1/contact-custom-fields", {
      headers: authHeaders(),
    });
    const fields = (await customFields.json()) as any;
    expect(fields.data.some((field: any) => field.key === "lead-score")).toBe(true);

    const del = await setup.app.request(`http://localhost/v1/contacts/${created.data.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(del.status).toBe(204);
  });

  it("lists phone numbers and supports userId filter", async () => {
    const list = await setup.app.request("http://localhost/v1/phone-numbers", {
      headers: authHeaders(),
    });
    const body = (await list.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(DEFAULT_PHONE_NUMBER_ID);
    expect(body.data[0].number).toBe(DEFAULT_PHONE_NUMBER);
    expect(body.data[0].users[0].email).toBe(DEFAULT_USER_EMAIL);

    const filtered = await setup.app.request(`http://localhost/v1/phone-numbers?userId=${DEFAULT_USER_ID}`, {
      headers: authHeaders(),
    });
    expect(((await filtered.json()) as any).data).toHaveLength(1);

    const empty = await setup.app.request("http://localhost/v1/phone-numbers?userId=USmissing", {
      headers: authHeaders(),
    });
    expect(((await empty.json()) as any).data).toHaveLength(0);
  });

  it("supports webhook CRUD", async () => {
    const create = await setup.app.request("http://localhost/v1/webhooks/messages", {
      method: "POST",
      headers: authHeaders(),
      body: jsonBody({
        url: "http://example.local/openphone",
        events: ["message.received"],
        label: "inbox",
        resourceIds: [DEFAULT_PHONE_NUMBER_ID],
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as any;
    expect(created.data.id).toMatch(/^WH/);
    expect(created.data.type).toBe("messages");
    expect(created.data.key).toBeTruthy();

    const list = await setup.app.request("http://localhost/v1/webhooks", { headers: authHeaders() });
    const listed = (await list.json()) as any;
    expect(listed.data.some((hook: any) => hook.id === created.data.id)).toBe(true);

    const get = await setup.app.request(`http://localhost/v1/webhooks/${created.data.id}`, {
      headers: authHeaders(),
    });
    expect(get.status).toBe(200);

    const del = await setup.app.request(`http://localhost/v1/webhooks/${created.data.id}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    expect(del.status).toBe(204);

    const missing = await setup.app.request(`http://localhost/v1/webhooks/${created.data.id}`, {
      headers: authHeaders(),
    });
    expect(missing.status).toBe(404);
  });

  it("renders the inspector with seeded resources", async () => {
    await setup.app.request("http://localhost/v1/messages", {
      method: "POST",
      headers: authHeaders(),
      body: jsonBody({ content: "Inspector", from: DEFAULT_PHONE_NUMBER, to: ["+15550005555"] }),
    });
    const res = await setup.app.request("http://localhost/?tab=messages");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("OpenPhone Inspector");
    expect(html).toContain("Inspector");
    expect(html).toContain("Messages");
  });

  it("signs and verifies openphone-signature values", () => {
    const key = Buffer.from("test-secret").toString("base64");
    const body = JSON.stringify({ hello: "world" });
    const header = signOpenPhoneWebhook("1710000000000", body, key);
    expect(header.startsWith("hmac;1;1710000000000;")).toBe(true);
    expect(verifyOpenPhoneSignature(header, body, key)).toBe(true);
    expect(verifyOpenPhoneSignature(header, '{"hello":"nope"}', key)).toBe(false);
  });
});
