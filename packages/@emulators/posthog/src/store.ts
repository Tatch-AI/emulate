import { Store, type Collection } from "@emulators/core";
import type {
  PostHogAnnotation,
  PostHogDecideLog,
  PostHogEvent,
  PostHogFeatureFlag,
  PostHogPerson,
  PostHogPersonalApiKey,
  PostHogProject,
} from "./entities.js";

export interface PostHogStore {
  projects: Collection<PostHogProject>;
  personalApiKeys: Collection<PostHogPersonalApiKey>;
  featureFlags: Collection<PostHogFeatureFlag>;
  persons: Collection<PostHogPerson>;
  events: Collection<PostHogEvent>;
  annotations: Collection<PostHogAnnotation>;
  decideLogs: Collection<PostHogDecideLog>;
}

export function getPostHogStore(store: Store): PostHogStore {
  return {
    projects: store.collection<PostHogProject>("posthog.projects", ["project_id", "api_key", "uuid"]),
    personalApiKeys: store.collection<PostHogPersonalApiKey>("posthog.personal_api_keys", ["key", "project_id"]),
    featureFlags: store.collection<PostHogFeatureFlag>("posthog.feature_flags", ["flag_id", "project_id", "key"]),
    persons: store.collection<PostHogPerson>("posthog.persons", ["uuid", "project_id"]),
    events: store.collection<PostHogEvent>("posthog.events", ["uuid", "project_id", "event", "distinct_id"]),
    annotations: store.collection<PostHogAnnotation>("posthog.annotations", ["annotation_id", "project_id"]),
    decideLogs: store.collection<PostHogDecideLog>("posthog.decide_logs", ["project_id", "distinct_id"]),
  };
}
