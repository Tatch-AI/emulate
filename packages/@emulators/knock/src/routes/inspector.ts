import type { InspectorTab, RouteContext } from "@emulators/core";
import { escapeHtml, renderInspectorPage } from "@emulators/core";
import { getKnockStore } from "../store.js";

const SERVICE_LABEL = "Knock";
const TABS: InspectorTab[] = [
  { id: "messages", label: "Messages", href: "/?tab=messages" },
  { id: "feed", label: "Feed", href: "/?tab=feed" },
  { id: "runs", label: "Workflow Runs", href: "/?tab=runs" },
  { id: "users", label: "Users", href: "/?tab=users" },
  { id: "objects", label: "Objects", href: "/?tab=objects" },
  { id: "workflows", label: "Workflows", href: "/?tab=workflows" },
  { id: "keys", label: "API Keys", href: "/?tab=keys" },
];

type TabId = (typeof TABS)[number]["id"];

function section(title: string, content: string): string {
  return `<div class="inspector-section"><h2>${escapeHtml(title)}</h2>${content}</div>`;
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `<p class="inspector-empty">${escapeHtml(empty)}</p>`;
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("");
  return `<table class="inspector-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function statusChip(status: string): string {
  return `<span class="badge badge-granted">${escapeHtml(status)}</span>`;
}

export function inspectorRoutes({ app, store }: RouteContext): void {
  const ks = () => getKnockStore(store);

  app.get("/", (c) => {
    const requested = c.req.query("tab") ?? "messages";
    const active = TABS.some((tab) => tab.id === requested) ? (requested as TabId) : "messages";
    const body =
      active === "feed"
        ? feedView()
        : active === "runs"
          ? runsView()
          : active === "users"
            ? usersView()
            : active === "objects"
              ? objectsView()
              : active === "workflows"
                ? workflowsView()
                : active === "keys"
                  ? keysView()
                  : messagesView();
    return c.html(renderInspectorPage("Knock Inspector", TABS, active, body, SERVICE_LABEL));
  });

  function messagesView(): string {
    const rows = ks()
      .messages.all()
      .sort((a, b) => b.id - a.id)
      .map((m) => [
        escapeHtml(m.message_id),
        statusChip(m.status),
        escapeHtml(m.engagement_statuses.join(", ") || "-"),
        escapeHtml(m.workflow_key),
        escapeHtml(m.channel_type),
        escapeHtml(typeof m.recipient === "string" ? m.recipient : `${m.recipient.collection}/${m.recipient.id}`),
        escapeHtml(m.tenant ?? ""),
        escapeHtml(m.created_at),
      ]);
    return section(
      "Messages",
      table(
        ["ID", "Status", "Engagement", "Workflow", "Channel", "Recipient", "Tenant", "Created"],
        rows,
        "No messages.",
      ),
    );
  }

  function feedView(): string {
    const feedMsgs = ks()
      .messages.all()
      .filter((m) => m.channel_type === "in_app_feed")
      .sort((a, b) => b.id - a.id);

    const byUser = new Map<string, typeof feedMsgs>();
    for (const m of feedMsgs) {
      const uid = m.recipient_user_id ?? (typeof m.recipient === "string" ? m.recipient : "object");
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid)!.push(m);
    }

    if (byUser.size === 0) return section("Feed Preview", `<p class="inspector-empty">No feed items.</p>`);

    let html = "";
    for (const [userId, msgs] of byUser) {
      const rows = msgs.map((m) => [
        escapeHtml(m.message_id),
        statusChip(m.engagement_statuses.includes("read") ? "read" : m.engagement_statuses.includes("seen") ? "seen" : "unseen"),
        escapeHtml(m.content.body ?? ""),
        escapeHtml(m.workflow_key),
        escapeHtml(m.created_at),
      ]);
      html += section(
        `User ${userId}`,
        table(["ID", "State", "Body", "Workflow", "Created"], rows, "No items."),
      );
    }
    return html;
  }

  function runsView(): string {
    const rows = ks()
      .workflowRuns.all()
      .sort((a, b) => b.id - a.id)
      .map((r) => [
        escapeHtml(r.workflow_run_id),
        escapeHtml(r.workflow_key),
        statusChip(r.status),
        escapeHtml(JSON.stringify(r.data)),
        escapeHtml(r.cancellation_key ?? ""),
        escapeHtml(String(r.message_ids.length)),
        escapeHtml(r.created_at),
      ]);
    return section(
      "Workflow Runs",
      table(["Run ID", "Workflow", "Status", "Data", "Cancel Key", "Messages", "Created"], rows, "No workflow runs."),
    );
  }

  function usersView(): string {
    const rows = ks()
      .users.all()
      .map((u) => [
        escapeHtml(u.user_id),
        escapeHtml(u.name ?? ""),
        escapeHtml(u.email ?? ""),
        escapeHtml(u.phone_number ?? ""),
        escapeHtml(u.created_at),
      ]);
    return section("Users", table(["ID", "Name", "Email", "Phone", "Created"], rows, "No users."));
  }

  function objectsView(): string {
    const rows = ks()
      .objects.all()
      .map((o) => [
        escapeHtml(o.collection),
        escapeHtml(o.object_id),
        escapeHtml(JSON.stringify(o.properties)),
        escapeHtml(
          String(ks().subscriptions.count((s) => s.collection === o.collection && s.object_id === o.object_id)),
        ),
      ]);
    return section("Objects", table(["Collection", "ID", "Properties", "Subscriptions"], rows, "No objects."));
  }

  function workflowsView(): string {
    const rows = ks()
      .workflows.all()
      .map((w) => [
        escapeHtml(w.key),
        escapeHtml(w.name),
        escapeHtml(String(w.steps.length)),
        escapeHtml(w.steps.map((s) => s.channel).join(", ")),
      ]);
    return section("Workflows", table(["Key", "Name", "Steps", "Channels"], rows, "No workflows seeded."));
  }

  function keysView(): string {
    const rows = ks()
      .apiKeys.all()
      .map((k) => [escapeHtml(k.name), escapeHtml(k.type), escapeHtml(k.key), escapeHtml(k.created_at)]);
    return section("API Keys", table(["Name", "Type", "Key", "Created"], rows, "No API keys seeded."));
  }
}
