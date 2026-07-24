import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderInspectorPage } from "@emulators/core";
import { getOpenAIStore } from "../store.js";
import { maskKey } from "../helpers.js";

const SERVICE_LABEL = "OpenAI";
const TABS: InspectorTab[] = [
  { id: "requests", label: "Request Log", href: "/?tab=requests" },
  { id: "models", label: "Models", href: "/?tab=models" },
  { id: "files", label: "Files", href: "/?tab=files" },
  { id: "batches", label: "Batches", href: "/?tab=batches" },
  { id: "keys", label: "API Keys", href: "/?tab=keys" },
];

type TabId = (typeof TABS)[number]["id"];

export function inspectorRoutes({ app, store }: RouteContext): void {
  const os = () => getOpenAIStore(store);

  app.get("/", (c) => {
    const requested = c.req.query("tab") ?? "requests";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "requests";
    const body =
      active === "models"
        ? modelsView()
        : active === "files"
          ? filesView()
          : active === "batches"
            ? batchesView()
            : active === "keys"
              ? keysView()
              : requestsView();
    return c.html(renderInspectorPage("OpenAI Inspector", TABS, active, body, SERVICE_LABEL));
  });

  function requestsView(): string {
    const rows = os()
      .requestLogs.all()
      .sort((a, b) => b.id - a.id)
      .slice(0, 100)
      .map((log) => [
        escapeHtml(log.request_id),
        escapeHtml(log.method),
        escapeHtml(log.path),
        escapeHtml(log.model ?? ""),
        escapeHtml(log.prompt_preview),
        escapeHtml(log.reply_preview),
        escapeHtml(String(log.prompt_tokens + log.completion_tokens)),
        escapeHtml(log.streamed ? "yes" : "no"),
        escapeHtml(String(log.created_unix)),
      ]);
    return section(
      "Request Log",
      table(
        ["Request ID", "Method", "Path", "Model", "Prompt", "Reply", "Tokens", "Streamed", "Created"],
        rows,
        "No API requests yet.",
      ),
    );
  }

  function modelsView(): string {
    const rows = os()
      .models.all()
      .map((model) => [
        escapeHtml(model.model_id),
        escapeHtml(model.owned_by),
        escapeHtml(String(model.created)),
      ]);
    return section("Models", table(["ID", "Owned By", "Created"], rows, "No models."));
  }

  function filesView(): string {
    const rows = os()
      .files.all()
      .filter((f) => f.status !== "deleted")
      .sort((a, b) => b.id - a.id)
      .map((file) => [
        escapeHtml(file.file_id),
        escapeHtml(file.filename),
        escapeHtml(file.purpose),
        escapeHtml(String(file.bytes)),
        escapeHtml(file.status),
        escapeHtml(String(file.created_unix)),
      ]);
    return section(
      "Files",
      table(["ID", "Filename", "Purpose", "Bytes", "Status", "Created"], rows, "No files."),
    );
  }

  function batchesView(): string {
    const rows = os()
      .batches.all()
      .sort((a, b) => b.id - a.id)
      .map((batch) => [
        escapeHtml(batch.batch_id),
        escapeHtml(batch.endpoint),
        escapeHtml(batch.status),
        escapeHtml(`${batch.request_counts.completed}/${batch.request_counts.total}`),
        escapeHtml(batch.output_file_id ?? ""),
        escapeHtml(String(batch.created_unix)),
      ]);
    return section(
      "Batches",
      table(["ID", "Endpoint", "Status", "Counts", "Output File", "Created"], rows, "No batches."),
    );
  }

  function keysView(): string {
    const keys = os().apiKeys.all();
    if (keys.length === 0) {
      return section(
        "API Keys",
        `<p class="inspector-empty">No API keys seeded. Any Bearer token is accepted.</p>`,
      );
    }
    const rows = keys.map((key) => [escapeHtml(key.name), escapeHtml(maskKey(key.key))]);
    return section("API Keys", table(["Name", "Key"], rows, "No API keys."));
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
