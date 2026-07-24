---
name: knock
description: Emulated Knock notification API for local development and testing. Use when the user needs to trigger Knock workflows, manage users/objects/preferences/tenants, read in-app feeds, mark messages seen/read/archived, or integrate @knocklabs/node without hitting api.knock.app. Triggers include "Knock API", "emulate Knock", "workflow trigger", "in-app feed", "KNOCK_BASE_URL", or local notification testing.
allowed-tools: Bash(npx emulate:*), Bash(emulate:*), Bash(curl:*)
---

# Knock Notification API Emulator

Fully stateful Knock API emulation. Seeded workflows, channels, users, tenants, and objects persist in memory. Triggering a workflow walks channel steps, renders `{{ }}` templates, and stores messages. In-app feed reads and engagement status updates work locally. No real email, SMS, push, or chat delivery.

## Start

```bash
npx emulate --service knock
```

Default URL when Knock is the only service: `http://localhost:4000`.

## Auth

```bash
curl http://localhost:4000/v1/users/user_1 \
  -H "Authorization: Bearer sk_test_secret"
```

When `api_keys` are seeded, only matching `sk_` secret keys authenticate server routes. When none are seeded, any Bearer token is accepted.

Feed endpoints (`GET /v1/users/:id/feeds/:channel_id`) also accept `pk_` public keys or no auth (relaxation versus production).

## Pointing Your App at the Emulator

```bash
KNOCK_BASE_URL=http://localhost:4000
KNOCK_API_KEY=sk_test_secret
```

```typescript
import Knock from '@knocklabs/node'

const knock = new Knock({
  apiKey: process.env.KNOCK_API_KEY,
  baseURL: process.env.KNOCK_BASE_URL,
})

await knock.users.update('user_1', { name: 'Ada', email: 'ada@example.com' })
await knock.workflows.trigger('welcome', {
  recipients: ['user_1'],
  data: { app: 'Demo' },
})
```

## Seed Config

```yaml
knock:
  api_keys:
    - sk_test_secret
    - pk_test_public
  channels:
    - id: in-app
      type: in_app_feed
    - id: email
      type: email
  workflows:
    - key: welcome
      steps:
        - channel: in-app
          template:
            body: "Hello {{ recipient.name }}"
        - channel: email
          template:
            subject: Welcome
            body: "Hi {{ recipient.name }}"
  users:
    - id: user_1
      name: Ada
      email: ada@example.com
```

## Core Routes

- `POST /v1/workflows/:key/trigger` — fan out messages per channel step
- `POST /v1/workflows/:key/cancel` — cancel by `cancellation_key`
- `PUT /v1/users/:user_id` — identify
- `GET /v1/messages` / engagement status routes
- `GET /v1/users/:user_id/feeds/:channel_id` — in-app feed + meta counts
- Objects, preferences, tenants under `/v1/objects`, `/v1/users/.../preferences`, `/v1/tenants`
- Inspector at `GET /`

## Preferences

Set `channel_types` or `workflows` on a preference set. Triggering skips channels the recipient turned off (`channel_types.email: false` skips email; `workflows.welcome: false` skips the whole workflow).

## Object subscriptions

Subscribe users to an object, then trigger with `{ id, collection }` recipients to fan out notifications to subscribers.

## Current Limits

No template/workflow design API, no real provider delivery, no delays/batching/branching, no schedules, no audiences, no MS Teams/Slack integrations, no guides.
