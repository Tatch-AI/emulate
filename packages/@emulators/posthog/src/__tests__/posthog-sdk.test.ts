import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostHog } from "posthog-node";
import {
  DEFAULT_PERSONAL_API_KEY,
  DEFAULT_PROJECT_API_KEY,
  getPostHogStore,
  startPostHogTestEmulator,
  type PostHogTestEmulator,
} from "./helpers.js";

describe("PostHog plugin - real posthog-node SDK", () => {
  let emulator: PostHogTestEmulator | undefined;

  beforeAll(async () => {
    emulator = await startPostHogTestEmulator({
      project: { api_key: DEFAULT_PROJECT_API_KEY, name: "SDK project" },
      personal_api_keys: [DEFAULT_PERSONAL_API_KEY],
      feature_flags: [
        {
          key: "sdk-flag",
          active: true,
          filters: { groups: [{ properties: [], rollout_percentage: 100 }] },
        },
        {
          key: "sdk-off",
          active: true,
          filters: { groups: [{ properties: [], rollout_percentage: 0 }] },
        },
      ],
    });
  });

  afterAll(async () => {
    await emulator?.close();
  });

  it("captures events through posthog-node and stores them locally", async () => {
    expect(emulator).toBeDefined();
    const client = new PostHog(DEFAULT_PROJECT_API_KEY, {
      host: emulator!.url,
      flushAt: 1,
      personalApiKey: DEFAULT_PERSONAL_API_KEY,
    });

    client.capture({
      distinctId: "sdk-user",
      event: "sdk_capture",
      properties: { source: "posthog-node" },
    });
    await client.shutdown();

    const events = getPostHogStore(emulator!.store).events.all();
    expect(events.some((event) => event.event === "sdk_capture" && event.distinct_id === "sdk-user")).toBe(true);
  });

  it("evaluates flags via getAllFlags and isFeatureEnabled using local evaluation", async () => {
    expect(emulator).toBeDefined();
    const client = new PostHog(DEFAULT_PROJECT_API_KEY, {
      host: emulator!.url,
      flushAt: 1,
      personalApiKey: DEFAULT_PERSONAL_API_KEY,
      featureFlagsPollingInterval: 100_000,
    });

    // Allow the poller to load definitions from /flags/definitions.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const enabled = await client.isFeatureEnabled("sdk-flag", "sdk-flag-user");
    expect(enabled).toBe(true);

    const disabled = await client.isFeatureEnabled("sdk-off", "sdk-flag-user");
    expect(disabled).toBe(false);

    const all = await client.getAllFlags("sdk-flag-user");
    expect(all["sdk-flag"]).toBe(true);
    expect(all["sdk-off"]).toBe(false);

    await client.shutdown();
  });
});
