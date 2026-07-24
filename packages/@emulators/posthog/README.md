# @emulators/posthog

PostHog API emulation with event capture, person identity, feature flag evaluation, private project APIs, and a local inspector.

Part of [emulate](https://github.com/vercel-labs/emulate) — local drop-in replacement services for CI and no-network sandboxes.

## Install

```bash
npm install @emulators/posthog
```

## Start

```bash
npx emulate --service posthog
```

Default credentials:

```text
POSTHOG_PROJECT_API_KEY=phc_test_key
POSTHOG_PERSONAL_API_KEY=phx_test_personal
```

Point SDKs at the emulator host:

```typescript
import { PostHog } from "posthog-node";

const posthog = new PostHog("phc_test_key", {
  host: "http://localhost:4000",
  personalApiKey: "phx_test_personal",
  flushAt: 1,
});
```

## Endpoints

### Capture (project API key in body)
- `POST /capture/`, `/batch/`, `/e/` — event ingestion aliases (`{"status":1}`)
- `POST /i/v0/e/` — modern ingestion alias (`{"status":"Ok"}`)

Accepts single events, `batch` arrays, and base64 `data` payloads (JSON or form-encoded). Handles `$identify`, `$set` / `$set_once`, `$create_alias`, and `$merge_dangerously`.

### Feature flags (project API key in body or `token`)
- `POST /decide/?v=3` and `?v=4`
- `POST /flags/?v=2`
- `GET /api/feature_flag/local_evaluation?token=<project_key>` (Bearer personal API key)
- `GET /flags/definitions?token=<project_key>` (same payload; used by current `posthog-node`)

### Private API (Bearer `phx_...`)
- `GET /api/projects/@current/` and `GET /api/projects/:id/`
- Feature flags CRUD under `/api/projects/:project_id/feature_flags/`
- Persons and events list/detail with filters and pagination
- Annotations create/list

### Inspector
- `GET /` — events, persons, feature flags, decide log, API keys

## Seed Configuration

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
  persons:
    - distinct_ids: [user-1]
      properties:
        email: user@example.com
```

## Current Limits

Not implemented: session recordings, cohort evaluation beyond empty cohort maps, insights / HogQL query API, surveys, group analytics beyond accepting `groups` on decide/flags requests, experiments UI, replay, error tracking, CDP / destinations, and real network export to PostHog Cloud.

## Links

- [Full documentation](https://emulate.dev)
- [GitHub](https://github.com/vercel-labs/emulate)
