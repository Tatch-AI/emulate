import { beforeEach, describe, expect, it } from "vitest";
import { apiHeaders, base, createTestApp, readJson, type AnthropicTestApp } from "./helpers.js";

describe("Anthropic message batches", () => {
  let app: AnthropicTestApp["app"];

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  it("creates a batch, lists it, fetches results jsonl, cancels, and deletes", async () => {
    const create = await app.request(`${base}/v1/messages/batches`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({
        requests: [
          {
            custom_id: "req-1",
            params: {
              model: "claude-sonnet-4-5",
              max_tokens: 32,
              messages: [{ role: "user", content: "batch one" }],
            },
          },
          {
            custom_id: "req-2",
            params: {
              model: "claude-sonnet-4-5",
              max_tokens: 32,
              messages: [{ role: "user", content: "batch two" }],
            },
          },
          {
            custom_id: "req-bad",
            params: {
              model: "missing-model",
              max_tokens: 8,
              messages: [{ role: "user", content: "nope" }],
            },
          },
        ],
      }),
    });
    expect(create.status).toBe(200);
    const batch = await readJson(create);
    expect(batch.id).toMatch(/^msgbatch_/);
    expect(batch.type).toBe("message_batch");
    expect(batch.processing_status).toBe("ended");
    expect(batch.request_counts).toMatchObject({
      processing: 0,
      succeeded: 2,
      errored: 1,
      canceled: 0,
      expired: 0,
    });
    expect(batch.results_url).toContain(`/v1/messages/batches/${batch.id}/results`);
    expect(batch.created_at).toBeTruthy();
    expect(batch.ended_at).toBeTruthy();
    expect(batch.expires_at).toBeTruthy();

    const listed = await readJson(await app.request(`${base}/v1/messages/batches`, { headers: apiHeaders() }));
    expect(listed.data.some((b: any) => b.id === batch.id)).toBe(true);
    expect(listed.first_id).toBeTruthy();

    const got = await readJson(await app.request(`${base}/v1/messages/batches/${batch.id}`, { headers: apiHeaders() }));
    expect(got.id).toBe(batch.id);

    const resultsRes = await app.request(`${base}/v1/messages/batches/${batch.id}/results`, {
      headers: apiHeaders(),
    });
    expect(resultsRes.status).toBe(200);
    const lines = (await resultsRes.text()).trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(3);
    const ok = lines.find((l) => l.custom_id === "req-1");
    expect(ok.result.type).toBe("succeeded");
    expect(ok.result.message.type).toBe("message");
    const bad = lines.find((l) => l.custom_id === "req-bad");
    expect(bad.result.type).toBe("errored");

    const cancel = await app.request(`${base}/v1/messages/batches/${batch.id}/cancel`, {
      method: "POST",
      headers: apiHeaders(),
    });
    expect(cancel.status).toBe(200);
    expect((await readJson(cancel)).cancel_initiated_at).toBeTruthy();

    const del = await app.request(`${base}/v1/messages/batches/${batch.id}`, {
      method: "DELETE",
      headers: apiHeaders(),
    });
    expect(del.status).toBe(200);
    expect(await readJson(del)).toEqual({ id: batch.id, type: "message_batch_deleted" });

    const missing = await app.request(`${base}/v1/messages/batches/${batch.id}`, { headers: apiHeaders() });
    expect(missing.status).toBe(404);
  });

  it("paginates batches with limit", async () => {
    for (let i = 0; i < 3; i++) {
      await app.request(`${base}/v1/messages/batches`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          requests: [
            {
              custom_id: `c-${i}`,
              params: {
                model: "claude-3-5-haiku-latest",
                max_tokens: 8,
                messages: [{ role: "user", content: `n${i}` }],
              },
            },
          ],
        }),
      });
    }
    const page = await readJson(await app.request(`${base}/v1/messages/batches?limit=2`, { headers: apiHeaders() }));
    expect(page.data.length).toBe(2);
    expect(page.has_more).toBe(true);
  });
});
