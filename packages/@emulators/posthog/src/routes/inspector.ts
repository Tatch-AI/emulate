import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderInspectorPage } from "@emulators/core";
import { maskKey } from "../helpers.js";
import { getPostHogStore } from "../store.js";

const SERVICE_LABEL = "PostHog";
const TABS: InspectorTab[] = [
  { id: "events", label: "Events", href: "/?tab=events" },
  { id: "persons", label: "Persons", href: "/?tab=persons" },
  { id: "flags", label: "Feature flags", href: "/?tab=flags" },
  { id: "decide", label: "Decide log", href: "/?tab=decide" },
  { id: "keys", label: "API keys", href: "/?tab=keys" },
];

type TabId = (typeof TABS)[number]["id"];

export function inspectorRoutes({ app, store }: RouteContext): void {
  const ps = () => getPostHogStore(store);

  app.get("/", (c) => {
    const requested = c.req.query("tab") ?? "events";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "events";
    const body =
      active === "persons"
        ? personsView()
        : active === "flags"
          ? flagsView()
          : active === "decide"
            ? decideView()
            : active === "keys"
              ? keysView()
              : eventsView();
    return c.html(renderInspectorPage("PostHog Inspector", TABS, active, body, SERVICE_LABEL));
  });

  function eventsView(): string {
    const rows = ps()
      .events.all()
      .sort((a, b) => b.id - a.id)
      .slice(0, 200)
      .map((event) => [
        escapeHtml(event.event),
        escapeHtml(event.distinct_id),
        escapeHtml(previewProps(event.properties)),
        escapeHtml(event.timestamp),
      ]);
    return section("Events", table(["Event", "Distinct ID", "Properties", "Timestamp"], rows, "No events captured."));
  }

  function personsView(): string {
    const rows = ps()
      .persons.all()
      .sort((a, b) => b.id - a.id)
      .map((person) => [
        escapeHtml(person.uuid),
        escapeHtml(person.distinct_ids.join(", ")),
        escapeHtml(previewProps(person.properties)),
      ]);
    return section("Persons", table(["UUID", "Distinct IDs", "Properties"], rows, "No persons."));
  }

  function flagsView(): string {
    const rows = ps()
      .featureFlags.all()
      .filter((flag) => !flag.deleted)
      .map((flag) => [
        escapeHtml(String(flag.flag_id)),
        escapeHtml(flag.key),
        escapeHtml(flag.active ? "active" : "inactive"),
        escapeHtml(JSON.stringify(flag.filters)),
      ]);
    return section("Feature flags", table(["ID", "Key", "Status", "Filters"], rows, "No feature flags."));
  }

  function decideView(): string {
    const rows = ps()
      .decideLogs.all()
      .sort((a, b) => b.id - a.id)
      .slice(0, 200)
      .map((log) => [
        escapeHtml(log.path),
        escapeHtml(`v=${log.version}`),
        escapeHtml(log.distinct_id),
        escapeHtml(String(log.flag_count)),
        escapeHtml(log.created_at),
      ]);
    return section(
      "Decide / flags requests",
      table(["Path", "Version", "Distinct ID", "Flags", "When"], rows, "No decide requests yet."),
    );
  }

  function keysView(): string {
    const projectRows = ps()
      .projects.all()
      .map((project) => [
        escapeHtml(String(project.project_id)),
        escapeHtml(project.name),
        escapeHtml(maskKey(project.api_key)),
      ]);
    const personalRows = ps()
      .personalApiKeys.all()
      .map((key) => [
        escapeHtml(key.label),
        escapeHtml(String(key.project_id)),
        escapeHtml(maskKey(key.key)),
      ]);
    return (
      section("Project API keys", table(["Project", "Name", "Key"], projectRows, "No project keys.")) +
      section("Personal API keys", table(["Label", "Project", "Key"], personalRows, "No personal API keys."))
    );
  }
}

function previewProps(properties: Record<string, unknown>): string {
  const json = JSON.stringify(properties);
  if (json.length <= 80) return json;
  return `${json.slice(0, 77)}...`;
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
