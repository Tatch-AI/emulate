import { afterAll, beforeAll, describe, expect, it } from "vitest";
import OpenAI from "openai";
import { startOpenAITestEmulator, type OpenAITestEmulator } from "./helpers.js";

describe("OpenAI plugin - official openai SDK compat", () => {
  let emulator: OpenAITestEmulator | undefined;
  let client: OpenAI;

  beforeAll(async () => {
    emulator = await startOpenAITestEmulator({
      responses: [
        { match: { content_contains: "sdk-hello" }, reply: "sdk-world" },
        { match: { content_contains: "sdk-stream" }, reply: "streamed-ok" },
      ],
      transcripts: [{ filename_contains: "sdk", text: "sdk transcript" }],
    });
    client = new OpenAI({
      apiKey: "sk-sdk-test",
      baseURL: `${emulator.url}/v1`,
    });
  });

  afterAll(async () => {
    await emulator?.close();
  });

  it("creates non-streaming chat completions", async () => {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "sdk-hello" }],
    });
    expect(completion.object).toBe("chat.completion");
    expect(completion.choices[0]?.message.content).toBe("sdk-world");
    expect(completion.usage?.total_tokens).toBeGreaterThan(0);
  });

  it("streams chat completions", async () => {
    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini",
      stream: true,
      messages: [{ role: "user", content: "sdk-stream" }],
    });
    let text = "";
    for await (const chunk of stream) {
      text += chunk.choices[0]?.delta?.content ?? "";
    }
    expect(text).toBe("streamed-ok");
  });

  it("creates embeddings", async () => {
    const result = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: "sdk embedding",
    });
    expect(result.data[0]?.embedding.length).toBe(1536);
  });

  it("lists models", async () => {
    const models = await client.models.list();
    const ids = [];
    for await (const model of models) {
      ids.push(model.id);
    }
    expect(ids).toContain("gpt-4o");
  });

  it("uploads and retrieves files", async () => {
    const file = await client.files.create({
      file: new File(["sdk file body"], "sdk.txt", { type: "text/plain" }),
      purpose: "user_data",
    });
    expect(file.id.startsWith("file-")).toBe(true);
    const retrieved = await client.files.retrieve(file.id);
    expect(retrieved.filename).toBe("sdk.txt");
    const content = await client.files.content(file.id);
    expect(await content.text()).toBe("sdk file body");
  });

  it("creates responses", async () => {
    const response = await client.responses.create({
      model: "gpt-4o",
      input: "sdk-hello from responses",
    });
    expect(response.id.startsWith("resp_")).toBe(true);
    expect(response.status).toBe("completed");
    const message = response.output.find((item) => item.type === "message");
    expect(message?.type).toBe("message");
    if (message?.type === "message") {
      const textPart = message.content.find((part) => part.type === "output_text");
      expect(textPart && textPart.type === "output_text" ? textPart.text : "").toBe("sdk-world");
    }
  });
});
