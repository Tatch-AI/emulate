import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { seedFromConfig } from "../index.js";
import { startAnthropicTestEmulator, type AnthropicTestEmulator } from "./helpers.js";

describe("Anthropic plugin - real @anthropic-ai/sdk baseline", () => {
  let emulator: AnthropicTestEmulator | undefined;
  let client: Anthropic;

  beforeAll(async () => {
    emulator = await startAnthropicTestEmulator({
      responses: [
        { match: { content_contains: "sdk-hello" }, reply: "hello from emulator" },
        {
          match: { content_contains: "sdk-tool" },
          tool_call: { name: "ping", input: { ok: true } },
        },
      ],
    });
    client = new Anthropic({
      apiKey: "sk-ant-sdk-test",
      baseURL: emulator.url,
    });
  });

  afterAll(async () => {
    await emulator?.close();
  });

  it("creates a non-streaming message", async () => {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 64,
      messages: [{ role: "user", content: "sdk-hello" }],
    });
    expect(message.type).toBe("message");
    expect(message.role).toBe("assistant");
    expect(message.content[0]).toMatchObject({ type: "text", text: "hello from emulator" });
    expect(message.usage.input_tokens).toBeGreaterThan(0);
  });

  it("streams message chunks with for-await", async () => {
    const stream = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 64,
      stream: true,
      messages: [{ role: "user", content: "sdk-hello" }],
    });

    const events: string[] = [];
    let text = "";
    for await (const event of stream) {
      events.push(event.type);
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
      }
    }
    expect(events[0]).toBe("message_start");
    expect(events).toContain("content_block_delta");
    expect(events).toContain("message_stop");
    expect(text).toBe("hello from emulator");
  });

  it("counts tokens through the SDK", async () => {
    const result = await client.messages.countTokens({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "count these tokens via sdk" }],
    });
    expect(result.input_tokens).toBeGreaterThan(0);
  });

  it("lists models through the SDK", async () => {
    const page = await client.models.list({ limit: 5 });
    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data[0]?.type).toBe("model");
  });

  it("creates a batch and reads results through the SDK", async () => {
    expect(emulator).toBeDefined();
    seedFromConfig(emulator!.store, emulator!.url, {
      responses: [{ match: { content_contains: "sdk-batch" }, reply: "batch-ok" }],
    });

    const batch = await client.messages.batches.create({
      requests: [
        {
          custom_id: "sdk-1",
          params: {
            model: "claude-sonnet-4-5",
            max_tokens: 32,
            messages: [{ role: "user", content: "sdk-batch" }],
          },
        },
      ],
    });
    expect(batch.id).toMatch(/^msgbatch_/);
    expect(batch.processing_status).toBe("ended");

    const decoder = await client.messages.batches.results(batch.id);
    const rows: Array<{ custom_id: string; result: any }> = [];
    for await (const row of decoder) {
      rows.push(row);
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]!.custom_id).toBe("sdk-1");
    expect(rows[0]!.result.type).toBe("succeeded");
    expect(rows[0]!.result.message.content[0].text).toBe("batch-ok");
  });
});
