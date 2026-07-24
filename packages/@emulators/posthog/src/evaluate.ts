import type { PostHogFeatureFlag, PostHogFlagGroup } from "./entities.js";
import { matchPropertyFilter, posthogHash } from "./helpers.js";

export type FlagValue = boolean | string;

export interface FlagEvaluationResult {
  key: string;
  enabled: boolean;
  value: FlagValue;
  variant: string | null;
  payload: unknown;
  reason: {
    code: string;
    condition_index: number | null;
    description: string;
  };
  metadata: {
    id: number;
    version: number;
    payload: unknown;
    description?: string | null;
  };
}

export function evaluateAllFlags(
  flags: PostHogFeatureFlag[],
  distinctId: string,
  personProperties: Record<string, unknown>,
): Record<string, FlagEvaluationResult> {
  const results: Record<string, FlagEvaluationResult> = {};
  for (const flag of flags) {
    if (flag.deleted || !flag.active) continue;
    results[flag.key] = evaluateFlag(flag, distinctId, personProperties);
  }
  return results;
}

export function evaluateFlag(
  flag: PostHogFeatureFlag,
  distinctId: string,
  personProperties: Record<string, unknown>,
): FlagEvaluationResult {
  const groups = flag.filters.groups ?? [{ properties: [], rollout_percentage: 100 }];
  let conditionIndex = 0;

  for (const group of groups) {
    const matched = groupMatches(group, personProperties);
    if (!matched) {
      conditionIndex += 1;
      continue;
    }

    const rollout = group.rollout_percentage;
    if (rollout != null && rollout < 100) {
      const hash = posthogHash(flag.key, distinctId);
      if (hash > rollout / 100) {
        return disabledResult(flag, "out_of_rollout_bound", conditionIndex, "Out of rollout bound");
      }
    }

    const multivariate = flag.filters.multivariate;
    if (multivariate?.variants?.length) {
      const variantKey = group.variant ?? pickVariant(flag.key, distinctId, multivariate.variants);
      if (!variantKey) {
        return disabledResult(flag, "no_condition_match", conditionIndex, "No variant matched");
      }
      const payload = flag.filters.payloads?.[variantKey] ?? null;
      return {
        key: flag.key,
        enabled: true,
        value: variantKey,
        variant: variantKey,
        payload,
        reason: {
          code: "condition_match",
          condition_index: conditionIndex,
          description: `Matched condition set ${conditionIndex}`,
        },
        metadata: {
          id: flag.flag_id,
          version: flag.version,
          payload,
          description: flag.name,
        },
      };
    }

    const payload = flag.filters.payloads?.["true"] ?? flag.filters.payloads?.true ?? null;
    return {
      key: flag.key,
      enabled: true,
      value: true,
      variant: null,
      payload,
      reason: {
        code: "condition_match",
        condition_index: conditionIndex,
        description: `Matched condition set ${conditionIndex}`,
      },
      metadata: {
        id: flag.flag_id,
        version: flag.version,
        payload,
        description: flag.name,
      },
    };
  }

  return disabledResult(flag, "no_condition_match", null, "No matching condition set");
}

function groupMatches(group: PostHogFlagGroup, personProperties: Record<string, unknown>): boolean {
  const properties = group.properties ?? [];
  if (properties.length === 0) return true;
  return properties.every((filter) => matchPropertyFilter(filter, personProperties));
}

function pickVariant(
  flagKey: string,
  distinctId: string,
  variants: Array<{ key: string; rollout_percentage: number }>,
): string | null {
  const hash = posthogHash(flagKey, distinctId, "variant");
  let cumulative = 0;
  for (const variant of variants) {
    const next = cumulative + variant.rollout_percentage / 100;
    if (hash >= cumulative && hash < next) return variant.key;
    cumulative = next;
  }
  // Floating-point edge: assign last variant when hash lands exactly on 1.0 boundary.
  if (variants.length > 0 && hash >= cumulative - 1e-12) {
    return variants[variants.length - 1].key;
  }
  return null;
}

function disabledResult(
  flag: PostHogFeatureFlag,
  code: string,
  conditionIndex: number | null,
  description: string,
): FlagEvaluationResult {
  return {
    key: flag.key,
    enabled: false,
    value: false,
    variant: null,
    payload: null,
    reason: { code, condition_index: conditionIndex, description },
    metadata: {
      id: flag.flag_id,
      version: flag.version,
      payload: null,
      description: flag.name,
    },
  };
}

export function toDecideV3(results: Record<string, FlagEvaluationResult>) {
  const featureFlags: Record<string, FlagValue> = {};
  const featureFlagPayloads: Record<string, unknown> = {};
  for (const [key, result] of Object.entries(results)) {
    featureFlags[key] = result.value;
    if (result.enabled && result.payload != null) {
      featureFlagPayloads[key] = result.payload;
    }
  }
  return {
    config: { enable_collect_everything: true },
    toolbarParams: {},
    isAuthenticated: false,
    supportedCompression: ["gzip", "gzip-js"],
    featureFlags,
    featureFlagPayloads,
    errorsWhileComputingFlags: false,
    sessionRecording: false,
  };
}

export function toDecideV4(results: Record<string, FlagEvaluationResult>) {
  const flags: Record<string, unknown> = {};
  for (const [key, result] of Object.entries(results)) {
    flags[key] = {
      key: result.key,
      enabled: result.enabled,
      variant: result.variant,
      reason: result.reason,
      metadata: result.metadata,
    };
  }
  return {
    flags,
    errorsWhileComputingFlags: false,
    requestId: null,
    evaluatedAt: Date.now(),
  };
}

export function toFlagsV2(results: Record<string, FlagEvaluationResult>) {
  return toDecideV4(results);
}
