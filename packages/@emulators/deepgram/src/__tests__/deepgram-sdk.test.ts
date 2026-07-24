import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeepgramClient } from "@deepgram/sdk";
import { deepgramTestKey, startDeepgramTestEmulator, type DeepgramTestEmulator } from "./helpers.js";

describe("Deepgram plugin - real @deepgram/sdk baseline", () => {
  let emulator: DeepgramTestEmulator | undefined;
  let client: DeepgramClient;

  beforeAll(async () => {
    emulator = await startDeepgramTestEmulator({
      projects: [{ name: "SDK Project" }],
      api_keys: [deepgramTestKey],
      transcripts: [{ text: "SDK transcribed this audio." }],
    });

    client = new DeepgramClient({
      apiKey: deepgramTestKey,
      baseUrl: emulator.url,
    });
  });

  afterAll(async () => {
    await emulator?.close();
  });

  it("transcribes a URL through listen.v1.media.transcribeUrl", async () => {
    const result = await client.listen.v1.media.transcribeUrl({
      url: "https://dpgr.am/spacewalk.wav",
      model: "nova-3",
      punctuate: true,
    });

    const body = result as { results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> } };
    const transcript = body.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    expect(transcript).toContain("SDK transcribed");
  });

  it("requests speech through speak.v1.audio.generate", async () => {
    const audio = await client.speak.v1.audio.generate({
      text: "Hello from SDK",
      model: "aura-2-thalia-en",
      container: "wav",
    });

    const bytes = new Uint8Array(await audio.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(44);
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe("RIFF");
  });

  it("lists projects through manage.v1.projects.list", async () => {
    const result = await client.manage.v1.projects.list();
    expect(result.projects?.length).toBeGreaterThan(0);
    expect(result.projects?.[0]?.name).toBe("SDK Project");
  });
});
