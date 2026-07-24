import { Store, type Collection } from "@emulators/core";
import type {
  DeepgramApiKey,
  DeepgramCallbackDelivery,
  DeepgramListenRequest,
  DeepgramMember,
  DeepgramProject,
  DeepgramReadRequest,
  DeepgramSpeakRequest,
  DeepgramTempToken,
  DeepgramTranscriptMatcher,
  DeepgramUsageRequest,
} from "./entities.js";

export interface DeepgramStore {
  projects: Collection<DeepgramProject>;
  apiKeys: Collection<DeepgramApiKey>;
  members: Collection<DeepgramMember>;
  tempTokens: Collection<DeepgramTempToken>;
  listenRequests: Collection<DeepgramListenRequest>;
  speakRequests: Collection<DeepgramSpeakRequest>;
  readRequests: Collection<DeepgramReadRequest>;
  usageRequests: Collection<DeepgramUsageRequest>;
  callbackDeliveries: Collection<DeepgramCallbackDelivery>;
  getTranscriptMatchers(): DeepgramTranscriptMatcher[];
  setTranscriptMatchers(matchers: DeepgramTranscriptMatcher[]): void;
  getReadMatchers(): DeepgramTranscriptMatcher[];
  setReadMatchers(matchers: DeepgramTranscriptMatcher[]): void;
  getDefaultSpeakModel(): string;
  setDefaultSpeakModel(model: string): void;
}

export function getDeepgramStore(store: Store): DeepgramStore {
  return {
    projects: store.collection<DeepgramProject>("deepgram.projects", ["project_id", "name"]),
    apiKeys: store.collection<DeepgramApiKey>("deepgram.api_keys", ["api_key_id", "key", "project_id"]),
    members: store.collection<DeepgramMember>("deepgram.members", ["member_id", "project_id"]),
    tempTokens: store.collection<DeepgramTempToken>("deepgram.temp_tokens", ["access_token"]),
    listenRequests: store.collection<DeepgramListenRequest>("deepgram.listen_requests", ["request_id"]),
    speakRequests: store.collection<DeepgramSpeakRequest>("deepgram.speak_requests", ["request_id"]),
    readRequests: store.collection<DeepgramReadRequest>("deepgram.read_requests", ["request_id"]),
    usageRequests: store.collection<DeepgramUsageRequest>("deepgram.usage_requests", ["request_id", "project_id"]),
    callbackDeliveries: store.collection<DeepgramCallbackDelivery>("deepgram.callback_deliveries", [
      "delivery_id",
      "request_id",
    ]),
    getTranscriptMatchers() {
      return (store.getData<DeepgramTranscriptMatcher[]>("deepgram.transcript_matchers") ?? []).slice();
    },
    setTranscriptMatchers(matchers) {
      store.setData("deepgram.transcript_matchers", matchers.slice());
    },
    getReadMatchers() {
      return (store.getData<DeepgramTranscriptMatcher[]>("deepgram.read_matchers") ?? []).slice();
    },
    setReadMatchers(matchers) {
      store.setData("deepgram.read_matchers", matchers.slice());
    },
    getDefaultSpeakModel() {
      return store.getData<string>("deepgram.default_speak_model") ?? "aura-2-thalia-en";
    },
    setDefaultSpeakModel(model) {
      store.setData("deepgram.default_speak_model", model);
    },
  };
}
