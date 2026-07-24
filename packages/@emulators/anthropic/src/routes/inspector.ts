import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderInspectorPage } from "@emulators/core";
import { getAnthropicStore } from "../store.js";

const SERVICE_LABEL = "Anthropic";
const TABS: InspectorTab[] = [
  { id: "requests", label: "Requests", href: "/?tab=requests" },
  { id: "models", label: "Models", href: "/?tab=models" },
  { id: "batches", label: "Batches", href: "/?tab=batches" },
  { id: "keys", label: "API Keys", href: "/?tab=keys" },
];

type TabId = (typeof TABS)[number]["id"];

export function inspectorRoutes({ app, store }: RouteContext): void {
  const as = () => getAnthropicStore(store);

  app.get("/", (c) => {
    const requested = c.req.query("tab") ?? "requests";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "requests";
    const body =
      active === "models"
        ? modelsView()
        : active === "batches"
          ? batchesView()
          : active === "keys"
            ? keysView()
            : requestsView();
    return c.html(renderInspectorPage("Anthropic Inspector", TABS, active, body, SERVICE_LABEL));
  });

  function requestsView(): string {
    const rows = as()
      .requestLogs.all()
      .sort((a, b) => b.id - a.id)
      .map((log) => [
        escapeHtml(log.kind),
        escapeHtml(log.model),
        escapeHtml(log.prompt_preview),
        escapeHtml(log.reply_preview),
        escapeHtml(log.stop_reason ?? ""),
        escapeHtml(`${log.input_tokens}/${log.output_tokens}`),
        escapeHtml(log.streamed ? "yes" : "no"),
        escapeHtml(log.created_at),
      ]);
    return section(
      "Message Request Log",
      table(
        ["Kind", "Model", "Prompt", "Reply", "Stop", "Tokens", "Streamed", "Created"],
        rows,
        "No requests yet.",
      ),
    );
  }

  function modelsView(): string {
    const rows = as()
      .models.all()
      .map((model) => [
        escapeHtml(model.model_id),
        escapeHtml(model.display_name),
        escapeHtml(model.alias_of ?? ""),
        escapeHtml(model.created_at_iso),
      ]);
    return section("Models", table(["ID", "Display Name", "Alias Of", "Created"], rows, "No models."));
  }

  function batchesView(): string {
    const rows = as()
      .batches.all()
      .sort((a, b) => b.id - a.id)
      .map((batch) => [
        escapeHtml(batch.batch_id),
        escapeHtml(batch.processing_status),
        escapeHtml(String(batch.request_counts.succeeded)),
        escapeHtml(String(batch.request_counts.errored)),
        escapeHtml(batch.created_at_iso),
      ]);
    return section(
      "Batches",
      table(["ID", "Status", "Succeeded", "Errored", "Created"], rows, "No batches."),
    );
  }

  function keysView(): string {
    const keys = as().apiKeys.all();
    if (keys.length === 0) {
      return section("API Keys", `<p class="inspector-empty">${escapeHtml("No keys seeded. Any API key is accepted.")}</p>`);
    }
    const rows = keys.map((key) => [
      escapeHtml(key.name),
      escapeHtml(maskKey(key.key)),
      escapeHtml(key.created_at),
    ]);
    return section("API Keys", table(["Name", "Key", "Created"], rows, "No API keys."));
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
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
