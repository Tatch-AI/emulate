import { Store, type Collection } from "@emulators/core";
import type {
  OpenPhoneApiKey,
  OpenPhoneCall,
  OpenPhoneCallSummary,
  OpenPhoneCallTranscript,
  OpenPhoneContact,
  OpenPhoneCustomFieldDef,
  OpenPhoneMessage,
  OpenPhonePhoneNumber,
  OpenPhoneRecording,
  OpenPhoneUser,
  OpenPhoneWebhook,
  OpenPhoneWebhookDelivery,
} from "./entities.js";

export interface OpenPhoneStore {
  apiKeys: Collection<OpenPhoneApiKey>;
  users: Collection<OpenPhoneUser>;
  phoneNumbers: Collection<OpenPhonePhoneNumber>;
  messages: Collection<OpenPhoneMessage>;
  calls: Collection<OpenPhoneCall>;
  recordings: Collection<OpenPhoneRecording>;
  summaries: Collection<OpenPhoneCallSummary>;
  transcripts: Collection<OpenPhoneCallTranscript>;
  contacts: Collection<OpenPhoneContact>;
  customFields: Collection<OpenPhoneCustomFieldDef>;
  webhooks: Collection<OpenPhoneWebhook>;
  webhookDeliveries: Collection<OpenPhoneWebhookDelivery>;
}

export function getOpenPhoneStore(store: Store): OpenPhoneStore {
  return {
    apiKeys: store.collection<OpenPhoneApiKey>("openphone.api_keys", ["key"]),
    users: store.collection<OpenPhoneUser>("openphone.users", ["openphone_id", "email"]),
    phoneNumbers: store.collection<OpenPhonePhoneNumber>("openphone.phone_numbers", [
      "openphone_id",
      "number",
    ]),
    messages: store.collection<OpenPhoneMessage>("openphone.messages", [
      "openphone_id",
      "phone_number_id",
      "conversation_id",
      "status",
    ]),
    calls: store.collection<OpenPhoneCall>("openphone.calls", ["openphone_id", "phone_number_id", "status"]),
    recordings: store.collection<OpenPhoneRecording>("openphone.recordings", ["openphone_id", "call_id"]),
    summaries: store.collection<OpenPhoneCallSummary>("openphone.summaries", ["call_id"]),
    transcripts: store.collection<OpenPhoneCallTranscript>("openphone.transcripts", ["call_id"]),
    contacts: store.collection<OpenPhoneContact>("openphone.contacts", ["openphone_id", "external_id", "source"]),
    customFields: store.collection<OpenPhoneCustomFieldDef>("openphone.custom_fields", ["key"]),
    webhooks: store.collection<OpenPhoneWebhook>("openphone.webhooks", ["openphone_id", "webhook_type"]),
    webhookDeliveries: store.collection<OpenPhoneWebhookDelivery>("openphone.webhook_deliveries", [
      "event_id",
      "webhook_id",
      "event",
    ]),
  };
}
