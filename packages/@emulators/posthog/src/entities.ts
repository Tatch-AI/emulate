import type { Entity } from "@emulators/core";

export interface PostHogPropertyFilter {
  key: string;
  type?: string;
  value?: unknown;
  operator?: string;
}

export interface PostHogFlagGroup {
  properties?: PostHogPropertyFilter[];
  rollout_percentage?: number | null;
  variant?: string | null;
}

export interface PostHogFlagVariant {
  key: string;
  name?: string;
  rollout_percentage: number;
}

export interface PostHogFlagFilters {
  groups?: PostHogFlagGroup[];
  multivariate?: { variants: PostHogFlagVariant[] } | null;
  payloads?: Record<string, unknown>;
  aggregation_group_type_index?: number | null;
}

export interface PostHogProject extends Entity {
  project_id: number;
  uuid: string;
  name: string;
  api_key: string;
}

export interface PostHogPersonalApiKey extends Entity {
  key: string;
  label: string;
  project_id: number;
}

export interface PostHogFeatureFlag extends Entity {
  flag_id: number;
  project_id: number;
  key: string;
  name: string;
  active: boolean;
  deleted: boolean;
  filters: PostHogFlagFilters;
  ensure_experience_continuity: boolean;
  rollout_percentage: number | null;
  version: number;
}

export interface PostHogPerson extends Entity {
  uuid: string;
  project_id: number;
  distinct_ids: string[];
  properties: Record<string, unknown>;
}

export interface PostHogEvent extends Entity {
  uuid: string;
  project_id: number;
  event: string;
  distinct_id: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

export interface PostHogAnnotation extends Entity {
  annotation_id: number;
  project_id: number;
  content: string;
  date_marker: string | null;
  scope: string;
}

export interface PostHogDecideLog extends Entity {
  project_id: number;
  distinct_id: string;
  path: string;
  version: string;
  flag_count: number;
  request_body: Record<string, unknown>;
}
