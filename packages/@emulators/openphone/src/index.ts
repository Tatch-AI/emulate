import type { Hono } from "@emulators/core";
import type { AppEnv, RouteContext, ServicePlugin, Store, TokenMap, WebhookDispatcher } from "@emulators/core";
import type {
  OpenPhoneCallStatus,
  OpenPhoneDialogueLine,
  OpenPhoneWebhookType,
} from "./entities.js";
import { getOpenPhoneStore } from "./store.js";
import {
  DEFAULT_API_KEY,
  DEFAULT_ORG_ID,
  DEFAULT_PHONE_NUMBER,
  DEFAULT_PHONE_NUMBER_ID,
  DEFAULT_USER_EMAIL,
  DEFAULT_USER_ID,
  fixedId,
  generateWebhookKey,
  openPhoneId,
} from "./helpers.js";
import { messageRoutes } from "./routes/messages.js";
import { callRoutes } from "./routes/calls.js";
import { contactRoutes } from "./routes/contacts.js";
import { phoneNumberRoutes } from "./routes/phone-numbers.js";
import { webhookRoutes } from "./routes/webhooks.js";
import { simulatorRoutes } from "./routes/simulator.js";
import { inspectorRoutes } from "./routes/inspector.js";

export { getOpenPhoneStore, type OpenPhoneStore } from "./store.js";
export * from "./entities.js";
export {
  DEFAULT_API_KEY,
  DEFAULT_ORG_ID,
  DEFAULT_PHONE_NUMBER,
  DEFAULT_PHONE_NUMBER_ID,
  DEFAULT_USER_EMAIL,
  DEFAULT_USER_ID,
  signOpenPhoneWebhook,
  verifyOpenPhoneSignature,
} from "./helpers.js";

export interface OpenPhoneSeedConfig {
  port?: number;
  api_keys?: Array<{ key: string; name?: string }>;
  users?: Array<{
    id?: string;
    first_name: string;
    last_name: string;
    email: string;
    role?: string;
  }>;
  phone_numbers?: Array<{
    id?: string;
    number: string;
    name?: string;
    users?: string[];
    group_id?: string;
    symbol?: string;
  }>;
  contacts?: Array<{
    id?: string;
    external_id?: string;
    source?: string;
    source_url?: string;
    default_fields?: {
      firstName?: string;
      lastName?: string;
      company?: string;
      role?: string;
      emails?: Array<{ name?: string; value?: string }>;
      phoneNumbers?: Array<{ name?: string; value?: string }>;
    };
    custom_fields?: Array<{ key: string; value?: string }>;
  }>;
  custom_fields?: Array<{ key: string; name: string; type?: string }>;
  webhooks?: Array<{
    id?: string;
    url: string;
    type: OpenPhoneWebhookType;
    events: string[];
    resourceIds?: string[];
    label?: string;
    key?: string;
    status?: "enabled" | "disabled";
    userId?: string;
  }>;
  calls?: Array<{
    id?: string;
    phone_number_id?: string;
    phone_number?: string;
    direction?: "incoming" | "outgoing";
    participants: string[];
    status?: OpenPhoneCallStatus;
    user_id?: string;
    duration?: number;
    answered?: boolean;
    recording?: { id?: string; url?: string; duration?: number };
    summary?: { summary?: string[]; nextSteps?: string[] };
    transcript?: { dialogue?: OpenPhoneDialogueLine[]; duration?: number };
  }>;
}

function seedDefaults(store: Store): void {
  seedFromConfig(store, "", {
    api_keys: [{ key: DEFAULT_API_KEY, name: "Local API Key" }],
    users: [
      {
        id: DEFAULT_USER_ID,
        first_name: "Local",
        last_name: "Owner",
        email: DEFAULT_USER_EMAIL,
        role: "owner",
      },
    ],
    phone_numbers: [
      {
        id: DEFAULT_PHONE_NUMBER_ID,
        number: DEFAULT_PHONE_NUMBER,
        name: "Local OpenPhone Number",
        users: [DEFAULT_USER_EMAIL],
      },
    ],
    custom_fields: [{ key: "lead-score", name: "Lead Score", type: "number" }],
  });
}

export function seedFromConfig(store: Store, _baseUrl: string, config: OpenPhoneSeedConfig): void {
  const ops = getOpenPhoneStore(store);

  for (const key of config.api_keys ?? []) {
    const existing = ops.apiKeys.findOneBy("key", key.key);
    if (existing) {
      ops.apiKeys.update(existing.id, {
        name: key.name ?? existing.name,
        active: true,
      });
      continue;
    }
    ops.apiKeys.insert({
      key: key.key,
      name: key.name ?? "API Key",
      active: true,
    });
  }

  for (const user of config.users ?? []) {
    const existing =
      (user.id ? ops.users.findOneBy("openphone_id", user.id) : undefined) ??
      ops.users.findOneBy("email", user.email);
    if (existing) {
      ops.users.update(existing.id, {
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role ?? existing.role,
      });
      continue;
    }
    ops.users.insert({
      openphone_id: user.id ?? openPhoneId("US", 8),
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role ?? "member",
    });
  }

  for (const number of config.phone_numbers ?? []) {
    const userIds = (number.users ?? [])
      .map((ref) => {
        const byEmail = ops.users.findOneBy("email", ref);
        if (byEmail) return byEmail.openphone_id;
        const byId = ops.users.findOneBy("openphone_id", ref);
        return byId?.openphone_id;
      })
      .filter((id): id is string => Boolean(id));

    const existing =
      (number.id ? ops.phoneNumbers.findOneBy("openphone_id", number.id) : undefined) ??
      ops.phoneNumbers.findOneBy("number", number.number);
    if (existing) {
      ops.phoneNumbers.update(existing.id, {
        number: number.number,
        name: number.name ?? existing.name,
        user_ids: userIds.length > 0 ? userIds : existing.user_ids,
        group_id: number.group_id ?? existing.group_id,
        symbol: number.symbol ?? existing.symbol,
        formatted_number: number.number,
      });
      continue;
    }
    ops.phoneNumbers.insert({
      openphone_id: number.id ?? openPhoneId("PN", 8),
      group_id: number.group_id ?? "G0001",
      name: number.name ?? number.number,
      number: number.number,
      symbol: number.symbol ?? "phone",
      user_ids: userIds,
      restrictions: {},
      formatted_number: number.number,
      forward: null,
      port_request_id: null,
      porting_status: null,
    });
  }

  for (const field of config.custom_fields ?? []) {
    const existing = ops.customFields.findOneBy("key", field.key);
    if (existing) {
      ops.customFields.update(existing.id, {
        name: field.name,
        field_type: field.type ?? existing.field_type,
      });
      continue;
    }
    ops.customFields.insert({
      key: field.key,
      name: field.name,
      field_type: field.type ?? "string",
    });
  }

  for (const contact of config.contacts ?? []) {
    const existing =
      (contact.id ? ops.contacts.findOneBy("openphone_id", contact.id) : undefined) ??
      (contact.external_id ? ops.contacts.findOneBy("external_id", contact.external_id) : undefined);
    const defaultFields = {
      firstName: contact.default_fields?.firstName ?? null,
      lastName: contact.default_fields?.lastName ?? null,
      company: contact.default_fields?.company ?? null,
      role: contact.default_fields?.role ?? null,
      emails: (contact.default_fields?.emails ?? []).map((email) => ({
        id: openPhoneId("EM", 8),
        name: email.name ?? "email",
        value: email.value ?? null,
      })),
      phoneNumbers: (contact.default_fields?.phoneNumbers ?? []).map((phone) => ({
        id: openPhoneId("PH", 8),
        name: phone.name ?? "phone",
        value: phone.value ?? null,
      })),
    };
    const customFields = (contact.custom_fields ?? []).map((field) => ({
      id: openPhoneId("CF", 8),
      key: field.key,
      value: field.value ?? null,
    }));
    if (existing) {
      ops.contacts.update(existing.id, {
        external_id: contact.external_id ?? existing.external_id,
        source: contact.source ?? existing.source,
        source_url: contact.source_url ?? existing.source_url,
        default_fields: defaultFields,
        custom_fields: customFields,
      });
      continue;
    }
    ops.contacts.insert({
      openphone_id: contact.id ?? openPhoneId("CN", 16),
      external_id: contact.external_id ?? null,
      source: contact.source ?? "public-api",
      source_url: contact.source_url ?? null,
      created_by_user_id: ops.users.all()[0]?.openphone_id ?? DEFAULT_USER_ID,
      default_fields: defaultFields,
      custom_fields: customFields,
    });
  }

  for (const hook of config.webhooks ?? []) {
    const existing = hook.id ? ops.webhooks.findOneBy("openphone_id", hook.id) : undefined;
    if (existing) {
      ops.webhooks.update(existing.id, {
        url: hook.url,
        events: hook.events,
        resource_ids: hook.resourceIds ?? existing.resource_ids,
        label: hook.label ?? existing.label,
        key: hook.key ?? existing.key,
        status: hook.status ?? existing.status,
        webhook_type: hook.type,
        user_id: hook.userId ?? existing.user_id,
      });
      continue;
    }
    ops.webhooks.insert({
      openphone_id: hook.id ?? openPhoneId("WH", 12),
      user_id: hook.userId ?? ops.users.all()[0]?.openphone_id ?? DEFAULT_USER_ID,
      org_id: DEFAULT_ORG_ID,
      label: hook.label ?? null,
      status: hook.status ?? "enabled",
      url: hook.url,
      key: hook.key ?? generateWebhookKey(),
      events: hook.events,
      resource_ids: hook.resourceIds ?? ["*"],
      webhook_type: hook.type,
      deleted_at: null,
    });
  }

  for (const callCfg of config.calls ?? []) {
    const phoneNumber =
      (callCfg.phone_number_id
        ? ops.phoneNumbers.findOneBy("openphone_id", callCfg.phone_number_id)
        : undefined) ??
      (callCfg.phone_number ? ops.phoneNumbers.findOneBy("number", callCfg.phone_number) : undefined) ??
      ops.phoneNumbers.all()[0];
    if (!phoneNumber) continue;

    const existing = callCfg.id ? ops.calls.findOneBy("openphone_id", callCfg.id) : undefined;
    const answered = callCfg.answered !== false && (callCfg.status ?? "completed") === "completed";
    const now = new Date().toISOString();
    const call =
      existing ??
      ops.calls.insert({
        openphone_id: callCfg.id ?? openPhoneId("AC", 20),
        phone_number_id: phoneNumber.openphone_id,
        user_id: callCfg.user_id ?? ops.users.all()[0]?.openphone_id ?? null,
        direction: callCfg.direction ?? "incoming",
        participants: callCfg.participants,
        status: callCfg.status ?? "completed",
        answered_at: answered ? now : null,
        answered_by: answered ? ops.users.all()[0]?.openphone_id ?? null : null,
        initiated_by: callCfg.direction === "outgoing" ? ops.users.all()[0]?.openphone_id ?? null : null,
        completed_at: now,
        duration: callCfg.duration ?? (answered ? 45 : 0),
        voicemail: null,
        call_route: null,
        forwarded_from: null,
        forwarded_to: null,
        ai_handled: false,
      });

    if (callCfg.recording) {
      const recordingExisting = callCfg.recording.id
        ? ops.recordings.findOneBy("openphone_id", callCfg.recording.id)
        : ops.recordings.findOneBy("call_id", call.openphone_id);
      if (!recordingExisting) {
        ops.recordings.insert({
          openphone_id: callCfg.recording.id ?? openPhoneId("CR", 10),
          call_id: call.openphone_id,
          url: callCfg.recording.url ?? `https://example.local/recordings/${call.openphone_id}.mp3`,
          duration: callCfg.recording.duration ?? call.duration,
          type: "audio/mpeg",
          start_time: call.answered_at ?? call.created_at,
          status: "completed",
        });
      }
    }

    if (callCfg.summary) {
      const summaryExisting = ops.summaries.findOneBy("call_id", call.openphone_id);
      if (!summaryExisting) {
        ops.summaries.insert({
          call_id: call.openphone_id,
          summary: callCfg.summary.summary ?? ["Seeded call summary."],
          next_steps: callCfg.summary.nextSteps ?? [],
          status: "completed",
        });
      }
    }

    if (callCfg.transcript) {
      const transcriptExisting = ops.transcripts.findOneBy("call_id", call.openphone_id);
      if (!transcriptExisting) {
        ops.transcripts.insert({
          call_id: call.openphone_id,
          duration: callCfg.transcript.duration ?? call.duration,
          status: "completed",
          dialogue: callCfg.transcript.dialogue ?? [
            {
              content: "Hello",
              start: 0,
              end: 1,
              identifier: call.participants[0] ?? phoneNumber.number,
              user_id: null,
            },
          ],
        });
      }
    }
  }
}

export const openphonePlugin: ServicePlugin = {
  name: "openphone",
  register(app: Hono<AppEnv>, store: Store, webhooks: WebhookDispatcher, baseUrl: string, tokenMap?: TokenMap): void {
    const ctx: RouteContext = { app, store, webhooks, baseUrl, tokenMap };
    messageRoutes(ctx);
    callRoutes(ctx);
    contactRoutes(ctx);
    phoneNumberRoutes(ctx);
    webhookRoutes(ctx);
    simulatorRoutes(ctx);
    inspectorRoutes(ctx);
  },
  seed(store: Store): void {
    seedDefaults(store);
  },
};

export default openphonePlugin;

// Keep fixedId available for tests that want deterministic IDs.
export { fixedId };
