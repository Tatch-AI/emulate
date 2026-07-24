import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Knock from "@knocklabs/node";
import { knockTestSecret, startKnockTestEmulator, type KnockTestEmulator } from "./helpers.js";

describe("Knock plugin - real @knocklabs/node baseline", () => {
  let emulator: KnockTestEmulator | undefined;
  let client: Knock;

  beforeAll(async () => {
    emulator = await startKnockTestEmulator();
    client = new Knock({
      apiKey: knockTestSecret,
      baseURL: emulator.url,
    });
  });

  afterAll(async () => {
    await emulator?.close();
  });

  it("identifies a user via users.update", async () => {
    const user = await client.users.update("sdk_user", {
      name: "SDK User",
      email: "sdk@example.com",
    });
    expect(user.id).toBe("sdk_user");
    expect(user.name).toBe("SDK User");
    expect(user.email).toBe("sdk@example.com");
  });

  it("triggers a workflow via workflows.trigger", async () => {
    const result = await client.workflows.trigger("sdk-welcome", {
      recipients: ["sdk_user"],
      data: { source: "sdk-test" },
    });
    expect(result.workflow_run_id).toBeTruthy();
  });

  it("lists messages via messages.list", async () => {
    const page = await client.messages.list({ page_size: 10 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items[0]?.id).toBeTruthy();
    expect(page.items[0]?.status).toBe("delivered");
  });

  it("lists user messages via users.listMessages", async () => {
    const page = await client.users.listMessages("sdk_user", { page_size: 10 });
    expect(page.items.length).toBeGreaterThan(0);
  });

  it("reads an in-app feed via users.feeds.listItems", async () => {
    const page = await client.users.feeds.listItems("sdk_user", "in-app", { page_size: 10 });
    expect(page.entries.length).toBeGreaterThan(0);
    expect(page.entries[0]?.__typename).toBe("FeedItem");
    expect(page.entries[0]?.blocks?.length).toBeGreaterThan(0);
  });

  it("marks a message seen via messages.markAsSeen", async () => {
    const page = await client.messages.list({ page_size: 1 });
    const id = page.items[0]!.id;
    const updated = await client.messages.markAsSeen(id);
    expect(updated.engagement_statuses).toContain("seen");
  });
});
