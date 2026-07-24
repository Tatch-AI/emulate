import { Store, type Collection } from "@emulators/core";
import type {
  OpenAIModel,
  OpenAIApiKey,
  OpenAIFile,
  OpenAIBatch,
  OpenAIResponseRecord,
  OpenAIRequestLog,
  OpenAIResponseMatcher,
  OpenAITranscriptSeed,
  OpenAIModerationTrigger,
} from "./entities.js";

export interface OpenAIStore {
  models: Collection<OpenAIModel>;
  apiKeys: Collection<OpenAIApiKey>;
  files: Collection<OpenAIFile>;
  batches: Collection<OpenAIBatch>;
  responses: Collection<OpenAIResponseRecord>;
  requestLogs: Collection<OpenAIRequestLog>;
  responseMatchers: Collection<OpenAIResponseMatcher>;
  transcripts: Collection<OpenAITranscriptSeed>;
  moderationTriggers: Collection<OpenAIModerationTrigger>;
}

export function getOpenAIStore(store: Store): OpenAIStore {
  return {
    models: store.collection<OpenAIModel>("openai.models", ["model_id"]),
    apiKeys: store.collection<OpenAIApiKey>("openai.api_keys", ["key"]),
    files: store.collection<OpenAIFile>("openai.files", ["file_id", "purpose"]),
    batches: store.collection<OpenAIBatch>("openai.batches", ["batch_id"]),
    responses: store.collection<OpenAIResponseRecord>("openai.responses", ["response_id"]),
    requestLogs: store.collection<OpenAIRequestLog>("openai.request_logs", ["request_id"]),
    responseMatchers: store.collection<OpenAIResponseMatcher>("openai.response_matchers", ["order"]),
    transcripts: store.collection<OpenAITranscriptSeed>("openai.transcripts", []),
    moderationTriggers: store.collection<OpenAIModerationTrigger>("openai.moderation_triggers", []),
  };
}
