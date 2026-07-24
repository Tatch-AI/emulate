import { Store, type Collection } from "@emulators/core";
import type {
  AnthropicApiKey,
  AnthropicBatch,
  AnthropicModel,
  AnthropicRequestLog,
  ResponseMatcher,
} from "./entities.js";

export interface AnthropicStore {
  models: Collection<AnthropicModel>;
  apiKeys: Collection<AnthropicApiKey>;
  requestLogs: Collection<AnthropicRequestLog>;
  batches: Collection<AnthropicBatch>;
}

export function getAnthropicStore(store: Store): AnthropicStore {
  return {
    models: store.collection<AnthropicModel>("anthropic.models", ["model_id"]),
    apiKeys: store.collection<AnthropicApiKey>("anthropic.api_keys", ["key"]),
    requestLogs: store.collection<AnthropicRequestLog>("anthropic.request_logs", ["request_id"]),
    batches: store.collection<AnthropicBatch>("anthropic.batches", ["batch_id"]),
  };
}

export function getResponseMatchers(store: Store): ResponseMatcher[] {
  return store.getData<ResponseMatcher[]>("anthropic.responses") ?? [];
}

export function setResponseMatchers(store: Store, matchers: ResponseMatcher[]): void {
  store.setData("anthropic.responses", matchers);
}
