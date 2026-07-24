---
name: posthog
description: Emulated PostHog analytics and feature flags API for local development and testing. Use when the user needs to capture events locally, evaluate feature flags, test posthog-node or posthog-js against a local host, inspect persons/events, manage flag definitions, or work with PostHog without hitting PostHog Cloud. Triggers include "PostHog", "emulate PostHog", "feature flags locally", "posthog-node", "phc_", "phx_", "decide endpoint", or any task requiring a local PostHog API.
allowed-tools: Bash(npx emulate:*), Bash(emulate:*), Bash(curl:*)
---

# PostHog API Emulator

Fully stateful PostHog emulation. Events, persons, feature flags, annotations, and decide logs persist in memory. Capture and flag evaluation match production request shapes closely enough for SDK compatibility tests.

No data is sent to PostHog Cloud.

## Start

```bash
npx emulate --service posthog
```

Default URL: `http://localhost:4000` when PostHog is the only service.

## Defaults

```text
POSTHOG_PROJECT_API_KEY=phc_test_key
POSTHOG_PERSONAL_API_KEY=phx_test_personal
```

## Auth

- Capture, `/decide`, and `/flags` carry the project API key (`phc_...`) in the JSON body as `api_key` or `token`. No `Authorization` header is required.
- Private project APIs and local evaluation require `Authorization: Bearer phx_...`.
- When no project keys are seeded, any `phc_` key is accepted (repo convention).

## Pointing SDKs at the Emulator

```typescript
import { PostHog } from "posthog-node";

const posthog = new PostHog("phc_test_key", {
  host: "http://localhost:4000",
  personalApiKey: "phx_test_personal",
  flushAt: 1,
});

posthog.capture({ distinctId: "user-1", event: "signed_up" });
await posthog.shutdown();
```

## Seed Config

```yaml
posthog:
  project:
    id: 1
    name: Default project
    api_key: phc_test_key
  personal_api_keys:
    - phx_test_personal
  feature_flags:
    - key: beta-feature
      active: true
      filters:
        groups:
          - properties: []
            rollout_percentage: 100
        multivariate:
          variants:
            - key: control
              rollout_percentage: 50
            - key: test
              rollout_percentage: 50
  persons:
    - distinct_ids: [user-1]
      properties:
        email: user@example.com
        plan: pro
```

## Core Routes

```bash
# Capture
curl -X POST http://localhost:4000/capture/ \
  -H "Content-Type: application/json" \
  -d '{"api_key":"phc_test_key","event":"signed_up","distinct_id":"user-1"}'

# Decide v3
curl -X POST "http://localhost:4000/decide/?v=3" \
  -H "Content-Type: application/json" \
  -d '{"api_key":"phc_test_key","distinct_id":"user-1"}'

# Flags v2
curl -X POST "http://localhost:4000/flags/?v=2" \
  -H "Content-Type: application/json" \
  -d '{"token":"phc_test_key","distinct_id":"user-1"}'

# Local evaluation definitions
curl "http://localhost:4000/api/feature_flag/local_evaluation?token=phc_test_key&send_cohorts" \
  -H "Authorization: Bearer phx_test_personal"

# Private persons / events
curl "http://localhost:4000/api/projects/1/events/?event=signed_up" \
  -H "Authorization: Bearer phx_test_personal"
```

## Inspector

Browse captured events, persons, flags, decide requests, and API keys:

```
http://localhost:4000/
```

## Current Limits

Session recordings, cohort evaluation (beyond empty cohort maps), insights / HogQL, surveys, group analytics beyond accepting `groups` on decide/flags, experiments UI, replay, error tracking, and CDP destinations are not implemented.
