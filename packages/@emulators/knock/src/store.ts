import { Store, type Collection } from "@emulators/core";
import type {
  KnockApiKey,
  KnockBulkOperation,
  KnockChannel,
  KnockMessage,
  KnockMessageEvent,
  KnockObject,
  KnockPreferenceSet,
  KnockSubscription,
  KnockTenant,
  KnockUser,
  KnockWorkflow,
  KnockWorkflowRun,
} from "./entities.js";

export interface KnockStore {
  apiKeys: Collection<KnockApiKey>;
  channels: Collection<KnockChannel>;
  workflows: Collection<KnockWorkflow>;
  users: Collection<KnockUser>;
  tenants: Collection<KnockTenant>;
  objects: Collection<KnockObject>;
  subscriptions: Collection<KnockSubscription>;
  preferences: Collection<KnockPreferenceSet>;
  messages: Collection<KnockMessage>;
  messageEvents: Collection<KnockMessageEvent>;
  workflowRuns: Collection<KnockWorkflowRun>;
  bulkOperations: Collection<KnockBulkOperation>;
}

export function getKnockStore(store: Store): KnockStore {
  return {
    apiKeys: store.collection<KnockApiKey>("knock.api_keys", ["key", "type"]),
    channels: store.collection<KnockChannel>("knock.channels", ["channel_id", "key", "type"]),
    workflows: store.collection<KnockWorkflow>("knock.workflows", ["key"]),
    users: store.collection<KnockUser>("knock.users", ["user_id"]),
    tenants: store.collection<KnockTenant>("knock.tenants", ["tenant_id"]),
    objects: store.collection<KnockObject>("knock.objects", ["collection", "object_id"]),
    subscriptions: store.collection<KnockSubscription>("knock.subscriptions", [
      "subscription_id",
      "collection",
      "object_id",
      "recipient_id",
    ]),
    preferences: store.collection<KnockPreferenceSet>("knock.preferences", ["user_id", "preference_id"]),
    messages: store.collection<KnockMessage>("knock.messages", [
      "message_id",
      "channel_id",
      "workflow_key",
      "workflow_run_id",
      "recipient_user_id",
      "tenant",
      "status",
      "cancellation_key",
    ]),
    messageEvents: store.collection<KnockMessageEvent>("knock.message_events", ["event_id", "message_id"]),
    workflowRuns: store.collection<KnockWorkflowRun>("knock.workflow_runs", [
      "workflow_run_id",
      "workflow_key",
      "cancellation_key",
      "status",
    ]),
    bulkOperations: store.collection<KnockBulkOperation>("knock.bulk_operations", ["bulk_id", "name"]),
  };
}
