# @emulators/knock

Knock notification API emulation with workflows, users, messages, in-app feeds, objects, preferences, tenants, and a local inspector.

Part of [emulate](https://github.com/vercel-labs/emulate) — local drop-in replacement services for CI and no-network sandboxes.

## Install

```bash
npm install @emulators/knock
```

## Endpoints

### Workflows
- `POST /v1/workflows/:key/trigger` — trigger a seeded workflow for recipients
- `POST /v1/workflows/:key/cancel` — cancel runs by `cancellation_key` (204)

### Users
- `PUT /v1/users/:user_id` — identify / upsert (deep-merge properties)
- `GET /v1/users/:user_id` — get user
- `DELETE /v1/users/:user_id` — delete user (204)
- `GET /v1/users` — list users (`entries` + `page_info` cursor pagination)
- `POST /v1/users/:user_id/merge` — merge `from_user_id` into user
- `POST /v1/users/bulk/identify` — bulk identify (sync BulkOperation)
- `GET /v1/users/:user_id/messages` — list messages for a user

### Messages
- `GET /v1/messages` — list messages (`items` + `page_info`; filters: `channel_id`, `workflow`, `tenant`, `status`)
- `GET /v1/messages/:id` — get message
- `GET /v1/messages/:id/content` — rendered channel content
- `GET /v1/messages/:id/events` — engagement / delivery events
- `PUT /v1/messages/:id/seen|read|interacted|archived`
- `DELETE /v1/messages/:id/seen|read|archived` — unseen / unread / unarchive
- `POST /v1/messages/batch/:status` — batch engagement (`seen`, `unseen`, `read`, `unread`, `interacted`, `archived`, `unarchived`)
- `POST /v1/channels/:channel_id/messages/bulk/:status` — bulk mark feed/channel messages

### Feeds (client API on the same server)
- `GET /v1/users/:user_id/feeds/:channel_id` — in-app feed with `meta` counts
- `POST /v1/users/:user_id/feeds/:channel_id/:status` — mark feed items (`seen`, `read`, …)
- `GET /v1/users/:user_id/feeds/:channel_id/settings`

Accepts `Authorization: Bearer pk_...` or secret key. No auth is also accepted (documented relaxation versus production's client host + user token).

### Objects
- `PUT|GET|DELETE /v1/objects/:collection/:object_id`
- `GET /v1/objects/:collection`
- `POST|GET|DELETE /v1/objects/:collection/:object_id/subscriptions`

### Preferences
- `GET /v1/users/:user_id/preferences`
- `GET|PUT /v1/users/:user_id/preferences/:id` (default id `default`)

### Tenants
- `PUT|GET|DELETE /v1/tenants/:id`
- `GET /v1/tenants`

### Inspector
- `GET /` — tabbed inspector (messages, feed preview, workflow runs, users, objects, workflows, API keys)

## Auth

Server routes expect `Authorization: Bearer sk_...`. When `api_keys` are seeded, only matching secret keys are accepted. When none are seeded, any non-empty Bearer token is accepted (repo convention).

## Seed Configuration

```yaml
knock:
  api_keys:
    - key: sk_test_secret
      type: secret
    - key: pk_test_public
      type: public
  channels:
    - id: in-app
      type: in_app_feed
      name: In-app Feed
    - id: email
      type: email
      name: Email
  workflows:
    - key: welcome
      name: Welcome
      steps:
        - channel: in-app
          template:
            body: "Hello {{ recipient.name }}"
        - channel: email
          template:
            subject: "Welcome"
            body: "Hi {{ recipient.name }}"
  users:
    - id: user_1
      name: Ada
      email: ada@example.com
  tenants:
    - id: acme
      name: Acme
  objects:
    - collection: projects
      id: proj_1
      name: Apollo
```

`seedFromConfig` is idempotent.

## Pointing the SDK at the emulator

```typescript
import Knock from '@knocklabs/node'

const knock = new Knock({
  apiKey: 'sk_test_secret',
  baseURL: 'http://localhost:4000', // or process.env.KNOCK_BASE_URL
})
```

## Current limits

- No template management / workflow design API (workflows are seed-only)
- No real channel delivery (email, SMS, push, chat providers)
- No delays, batching, branching, fetch, or throttle steps in workflow execution
- No schedules API
- No audiences
- No MS Teams / Slack channel integrations
- No guides API
- Feed auth is relaxed (same host; optional public key or no auth)

## Links

- [Full documentation](https://emulate.dev)
- [GitHub](https://github.com/vercel-labs/emulate)
