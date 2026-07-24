import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderInspectorPage } from "@emulators/core";
import { getOpenPhoneStore } from "../store.js";
import { maskSecret } from "../helpers.js";

const SERVICE_LABEL = "OpenPhone";
const TABS: InspectorTab[] = [
  { id: "messages", label: "Messages", href: "/?tab=messages" },
  { id: "calls", label: "Calls", href: "/?tab=calls" },
  { id: "contacts", label: "Contacts", href: "/?tab=contacts" },
  { id: "numbers", label: "Phone Numbers", href: "/?tab=numbers" },
  { id: "webhooks", label: "Webhooks", href: "/?tab=webhooks" },
  { id: "keys", label: "API Keys", href: "/?tab=keys" },
];

type TabId = (typeof TABS)[number]["id"];

export function inspectorRoutes({ app, store }: RouteContext): void {
  const ops = () => getOpenPhoneStore(store);

  app.get("/", (c) => {
    const requested = c.req.query("tab") ?? "messages";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "messages";
    const body =
      active === "calls"
        ? callsView()
        : active === "contacts"
          ? contactsView()
          : active === "numbers"
            ? numbersView()
            : active === "webhooks"
              ? webhooksView()
              : active === "keys"
                ? keysView()
                : messagesView();
    return c.html(renderInspectorPage("OpenPhone Inspector", TABS, active, body, SERVICE_LABEL));
  });

  function messagesView(): string {
    const rows = ops()
      .messages.all()
      .sort((a, b) => b.id - a.id)
      .map((message) => [
        escapeHtml(message.openphone_id),
        escapeHtml(message.direction),
        escapeHtml(message.status),
        escapeHtml(message.from),
        escapeHtml(message.to.join(", ")),
        escapeHtml(message.text),
        escapeHtml(message.created_at),
      ]);
    return section(
      "Messages",
      table(["ID", "Direction", "Status", "From", "To", "Text", "Created"], rows, "No messages."),
    );
  }

  function callsView(): string {
    const callRows = ops()
      .calls.all()
      .sort((a, b) => b.id - a.id)
      .map((call) => [
        escapeHtml(call.openphone_id),
        escapeHtml(call.direction),
        escapeHtml(call.status),
        escapeHtml(call.participants.join(", ")),
        escapeHtml(String(call.duration)),
        escapeHtml(call.created_at),
      ]);
    const recordingRows = ops()
      .recordings.all()
      .map((recording) => [
        escapeHtml(recording.openphone_id),
        escapeHtml(recording.call_id),
        escapeHtml(recording.status),
        escapeHtml(String(recording.duration)),
        escapeHtml(recording.url),
      ]);
    const summaryRows = ops()
      .summaries.all()
      .map((summary) => [
        escapeHtml(summary.call_id),
        escapeHtml(summary.status),
        escapeHtml(summary.summary.join(" | ")),
        escapeHtml(summary.next_steps.join(" | ")),
      ]);
    const transcriptRows = ops()
      .transcripts.all()
      .map((transcript) => [
        escapeHtml(transcript.call_id),
        escapeHtml(transcript.status),
        escapeHtml(String(transcript.duration)),
        escapeHtml(String(transcript.dialogue.length)),
      ]);
    return (
      section(
        "Calls",
        table(["ID", "Direction", "Status", "Participants", "Duration", "Created"], callRows, "No calls."),
      ) +
      section(
        "Recordings",
        table(["ID", "Call", "Status", "Duration", "URL"], recordingRows, "No recordings."),
      ) +
      section("Summaries", table(["Call", "Status", "Summary", "Next Steps"], summaryRows, "No summaries.")) +
      section(
        "Transcripts",
        table(["Call", "Status", "Duration", "Lines"], transcriptRows, "No transcripts."),
      )
    );
  }

  function contactsView(): string {
    const rows = ops()
      .contacts.all()
      .sort((a, b) => b.id - a.id)
      .map((contact) => [
        escapeHtml(contact.openphone_id),
        escapeHtml(
          [contact.default_fields.firstName, contact.default_fields.lastName].filter(Boolean).join(" ") || "",
        ),
        escapeHtml(contact.external_id ?? ""),
        escapeHtml(contact.source ?? ""),
        escapeHtml(contact.created_at),
      ]);
    return section(
      "Contacts",
      table(["ID", "Name", "External ID", "Source", "Created"], rows, "No contacts."),
    );
  }

  function numbersView(): string {
    const rows = ops()
      .phoneNumbers.all()
      .map((number) => [
        escapeHtml(number.openphone_id),
        escapeHtml(number.number),
        escapeHtml(number.name),
        escapeHtml(number.user_ids.join(", ")),
      ]);
    return section("Phone Numbers", table(["ID", "Number", "Name", "Users"], rows, "No phone numbers."));
  }

  function webhooksView(): string {
    const hookRows = ops()
      .webhooks.all()
      .filter((hook) => !hook.deleted_at)
      .map((hook) => [
        escapeHtml(hook.openphone_id),
        escapeHtml(hook.webhook_type),
        escapeHtml(hook.status),
        escapeHtml(hook.url),
        escapeHtml(hook.events.join(", ")),
        escapeHtml(hook.resource_ids.join(", ")),
      ]);
    const deliveryRows = ops()
      .webhookDeliveries.all()
      .slice(-50)
      .reverse()
      .map((delivery) => [
        escapeHtml(delivery.event),
        escapeHtml(delivery.webhook_id),
        escapeHtml(delivery.url),
        escapeHtml(String(delivery.response_status ?? "")),
        escapeHtml(delivery.success ? "ok" : "failed"),
        escapeHtml(delivery.error ?? ""),
        escapeHtml(delivery.created_at),
      ]);
    return (
      section(
        "Subscriptions",
        table(["ID", "Type", "Status", "URL", "Events", "Resources"], hookRows, "No webhooks."),
      ) +
      section(
        "Delivery Log",
        table(["Event", "Webhook", "URL", "Status", "Result", "Error", "Created"], deliveryRows, "No deliveries."),
      )
    );
  }

  function keysView(): string {
    const rows = ops()
      .apiKeys.all()
      .map((key) => [
        escapeHtml(key.name),
        escapeHtml(maskSecret(key.key)),
        escapeHtml(key.active ? "active" : "inactive"),
        escapeHtml(key.created_at),
      ]);
    return section("API Keys", table(["Name", "Key", "Status", "Created"], rows, "No API keys."));
  }
}

function section(title: string, body: string): string {
  return `<section class="inspector-section">
  <h2>${escapeHtml(title)}</h2>
  ${body}
</section>`;
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<p class="inspector-empty">${escapeHtml(empty)}</p>`;
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const rowHtml = rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("\n");
  return `<table class="inspector-table">
  <thead><tr>${headerHtml}</tr></thead>
  <tbody>
${rowHtml}
  </tbody>
</table>`;
}
