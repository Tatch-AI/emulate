import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderInspectorPage } from "@emulators/core";
import { getDeepgramStore } from "../store.js";
import { maskKey } from "../helpers.js";

const SERVICE_LABEL = "Deepgram";
const TABS: InspectorTab[] = [
  { id: "listen", label: "Transcription", href: "/?tab=listen" },
  { id: "speak", label: "TTS", href: "/?tab=speak" },
  { id: "projects", label: "Projects", href: "/?tab=projects" },
  { id: "tokens", label: "Temp Tokens", href: "/?tab=tokens" },
  { id: "callbacks", label: "Callbacks", href: "/?tab=callbacks" },
];

type TabId = (typeof TABS)[number]["id"];

export function inspectorRoutes({ app, store }: RouteContext): void {
  const ds = () => getDeepgramStore(store);

  app.get("/", (c) => {
    const requested = c.req.query("tab") ?? "listen";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "listen";
    const body =
      active === "speak"
        ? speakView()
        : active === "projects"
          ? projectsView()
          : active === "tokens"
            ? tokensView()
            : active === "callbacks"
              ? callbacksView()
              : listenView();
    return c.html(renderInspectorPage("Deepgram Inspector", TABS, active, body, SERVICE_LABEL));
  });

  function listenView(): string {
    const rows = ds()
      .listenRequests.all()
      .sort((a, b) => b.id - a.id)
      .map((req) => [
        escapeHtml(req.request_id),
        escapeHtml(req.model),
        escapeHtml(req.source_url ?? req.source),
        escapeHtml(req.transcript.slice(0, 80)),
        escapeHtml(JSON.stringify(req.features)),
        escapeHtml(req.created),
      ]);
    return section(
      "Transcription Requests",
      table(["Request ID", "Model", "Source", "Transcript", "Features", "Created"], rows, "No transcription requests."),
    );
  }

  function speakView(): string {
    const rows = ds()
      .speakRequests.all()
      .sort((a, b) => b.id - a.id)
      .map((req) => [
        escapeHtml(req.request_id),
        escapeHtml(req.model),
        escapeHtml(req.text.slice(0, 80)),
        escapeHtml(String(req.char_count)),
        escapeHtml(req.encoding),
        escapeHtml(req.created),
      ]);
    return section("TTS Requests", table(["Request ID", "Model", "Text", "Chars", "Encoding", "Created"], rows, "No TTS requests."));
  }

  function projectsView(): string {
    const projectRows = ds()
      .projects.all()
      .map((p) => [escapeHtml(p.project_id), escapeHtml(p.name), escapeHtml(p.company ?? "")]);
    const keyRows = ds()
      .apiKeys.all()
      .map((key) => [
        escapeHtml(key.api_key_id),
        escapeHtml(key.project_id),
        escapeHtml(key.comment),
        escapeHtml(maskKey(key.key)),
        escapeHtml(key.scopes.join(", ")),
      ]);
    return (
      section("Projects", table(["Project ID", "Name", "Company"], projectRows, "No projects.")) +
      section("API Keys", table(["Key ID", "Project", "Comment", "Key", "Scopes"], keyRows, "No API keys."))
    );
  }

  function tokensView(): string {
    const rows = ds()
      .tempTokens.all()
      .sort((a, b) => b.id - a.id)
      .map((token) => [
        escapeHtml(maskKey(token.access_token)),
        escapeHtml(String(token.expires_in)),
        escapeHtml(new Date(token.expires_at).toISOString()),
        escapeHtml(token.expires_at <= Date.now() ? "expired" : "active"),
      ]);
    return section("Temporary Tokens", table(["Token", "TTL", "Expires", "Status"], rows, "No temporary tokens."));
  }

  function callbacksView(): string {
    const rows = ds()
      .callbackDeliveries.all()
      .sort((a, b) => b.id - a.id)
      .map((d) => [
        escapeHtml(d.request_id),
        escapeHtml(d.url),
        escapeHtml(String(d.status_code ?? "")),
        escapeHtml(d.success ? "ok" : "failed"),
        escapeHtml(d.error ?? ""),
        escapeHtml(d.delivered_at),
      ]);
    return section(
      "Callback Deliveries",
      table(["Request ID", "URL", "Status", "Result", "Error", "Delivered"], rows, "No callback deliveries."),
    );
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
