# emulate Architecture

## Overview

pnpm + Turborepo monorepo. Each third-party API is an independent package under
`packages/@emulators/<name>` implementing the `ServicePlugin` interface from
`@emulators/core`. The `emulate` CLI package (`packages/emulate`) loads plugins from
`SERVICE_REGISTRY`, spins up one Hono HTTP server per selected service, and prints URLs.

```
┌─────────────────────────────────────────────────────────────────┐
│  npx emulate  /  createEmulator()  /  adapter-next|nuxt         │
│                    packages/emulate                              │
│                         │                                        │
│              packages/emulate/src/registry.ts                    │
│                         │                                        │
│    ┌────────────────────┼────────────────────┐                    │
│    ▼                    ▼                    ▼                    │
│ @emulators/core    @emulators/openai    @emulators/clerk  …     │
│  Store, Hono,      routes + seed      routes + seed             │
│  WebhookDispatcher, auth middleware                             │
└─────────────────────────────────────────────────────────────────┘
         ▲ HTTP (vendor-shaped paths)
         │  tests / apps swap base URL only
┌────────┴────────┐
│ Harper services │
│  & frontend apps│
└─────────────────┘
```

No database, no Kafka, no deployable server in prod — everything is in-memory per process.

---

## Entrypoints

### CLI (`packages/emulate`)

| Command | File | Purpose |
|---|---|---|
| `emulate` / `emulate start` | `src/commands/start.ts` | Start one or all emulators; `--service`, `--port`, `--seed`, `--portless` |
| `emulate list` | `src/commands/list.ts` | Print registered service names and endpoint summaries |
| `emulate init` | `src/commands/init.ts` | Write starter `emulate.config.yaml` |
| Bin | `src/index.ts` | Commander program, default port from `EMULATE_PORT` / `PORT` |

### Programmatic API

| Export | File | Purpose |
|---|---|---|
| `createEmulator(options)` | `packages/emulate/src/api.ts` | Single-service lifecycle: `url`, `reset()`, `close()` |
| `createEmulateHandler()` | `packages/@emulators/adapter-next` | Next.js App Router catch-all route |
| `createEmulateHandler()` | `packages/@emulators/adapter-nuxt` | Nuxt server route handler |

### Docs site

`apps/web` — Next.js documentation site (not required for CI emulation).

---

## Core framework (`packages/@emulators/core`)

| Component | Path | Role |
|---|---|---|
| `createServer()` | `src/server.ts` | Builds Hono app: CORS, auth middleware, rate-limit headers, plugin routes |
| `Store` | `src/store.ts` | In-memory collections with CRUD, indexes, cursor pagination |
| `WebhookDispatcher` | `src/webhooks.ts` | HTTP POST to subscriber URLs with vendor-specific signatures |
| `ServicePlugin` | `src/plugin.ts` | `{ name, routes(app, ctx), seed? }` contract each emulator implements |
| `serve()` | `src/http.ts` | Node HTTP server wrapper |

Auth: Bearer tokens from seed `tokens:` map; per-plugin `defaultFallback()` when no token
matches. GitHub public reads work without auth; OpenAI/Anthropic accept any key when
`api_keys` not seeded.

---

## Registered emulators (full inventory)

Source of truth: `packages/emulate/src/registry.ts` — `SERVICE_NAMES` (20 entries).

### Harper-critical (comms, intake, agents, auth)

| Key | Package | Notable routes / behavior |
|---|---|---|
| `clerk` | `@emulators/clerk` | OIDC, users, orgs, sessions — `packages/@emulators/clerk/src/routes/*` |
| `openphone` | `@emulators/openphone` | `POST /v1/messages`, calls, webhooks, `/_openphone/simulate/*` |
| `twilio` | `@emulators/twilio` | 2010 API, `/messaging/v1`, `/verify/v2` (OTP `123456`), Conversations |
| `deepgram` | `@emulators/deepgram` | `POST /v1/listen`, `/v1/speak`, `/v1/read`, project/key management |
| `openai` | `@emulators/openai` | `/v1/chat/completions`, `/v1/responses`, embeddings, audio, batches |
| `anthropic` | `@emulators/anthropic` | `/v1/messages`, streaming SSE, message batches |
| `knock` | `@emulators/knock` | `/v1/workflows/:key/trigger`, feeds, users, preferences |
| `slack` | `@emulators/slack` | Web API `POST /api/*`, OAuth v2, incoming webhooks, inspector |
| `google` | `@emulators/google` | OAuth + Gmail v1, Calendar v3, Drive v3 |
| `resend` | `@emulators/resend` | Emails, domains, contacts |

### Platform / DevEx / analytics

| Key | Package | Notable routes |
|---|---|---|
| `github` | `@emulators/github` | REST v3 — repos, issues, PRs, Actions, webhooks |
| `vercel` | `@emulators/vercel` | Deployments, projects, env, blob API |
| `aws` | `@emulators/aws` | S3 path-style, SQS/IAM/STS query API |
| `linear` | `@emulators/linear` | GraphQL `POST /graphql`, OAuth, webhooks |
| `posthog` | `@emulators/posthog` | `/capture`, `/decide`, `/flags`, private project API |
| `mongoatlas` | `@emulators/mongoatlas` | Atlas Admin v2 + Data API v1 |
| `stripe` | `@emulators/stripe` | Payment intents, checkout sessions, customers |
| `microsoft` | `@emulators/microsoft` | Entra OIDC + Graph `/v1.0/me` |
| `apple` | `@emulators/apple` | Sign in with Apple OIDC |
| `okta` | `@emulators/okta` | OIDC + users/groups/apps management |

Default port assignment: `basePort + index` in registry order (4000 + i). See root README
Quick Start table.

---

## Configuration

| Mechanism | Details |
|---|---|
| Auto-detect files | `emulate.config.yaml`, `.yml`, `.json`, `service-emulator.config.*` in CWD |
| `--seed <path>` | Explicit YAML/JSON |
| Per-service block | e.g. `openai.api_keys`, `twilio.verify_services[].code` |
| `tokens:` | Global bearer map for GitHub-style multi-user auth |
| Env | `EMULATE_PORT`, `PORT`, `EMULATE_BASE_URL`, `PORTLESS_URL` |
| `--portless` | Registers `*.emulate.localhost` via [portless](https://github.com/vercel-labs/portless) |

---

## Data

**No persistent database.** All state lives in `Store` collections inside the Node process.
`store.reset()` clears and re-runs `plugin.seed()` + `seedFromConfig()`.

Webhook delivery log and inspector UIs read from the same store.

---

## Events

emulate does not emit or consume Kafka/Relay topics. **Outbound webhooks** simulate vendor
event buses:

| Emulator | Webhook examples |
|---|---|
| GitHub | `push`, `pull_request`, repo/org hook deliveries with `X-Hub-Signature-256` |
| Slack | `event_callback` to configured request URLs |
| OpenPhone | `message.delivered`, `call.completed` with `openphone-signature` |
| Twilio | Status callbacks on messages/calls |
| Linear | GraphQL `webhookCreate` deliveries |

---

## External services

emulate **does not call** production vendors. It **implements** their HTTP APIs locally.
See [BUSINESS_CONTEXT.md](./BUSINESS_CONTEXT.md) for the full vendor ↔ Harper domain matrix.

---

## Key flows

### 1. CI integration test with one vendor

```
1. beforeAll: createEmulator({ service: 'openphone', port: 4017 })
2. process.env.OPENPHONE_API_URL = emulator.url
3. Run app code → POST /v1/messages → in-memory store
4. afterEach: emulator.reset()
5. afterAll: emulator.close()
```

### 2. Full local stack (`npx emulate`)

```
1. startCommand loads seed (or defaults)
2. For each service in SERVICE_NAMES (or --service filter):
     entry.load() → dynamic import @emulators/<name>
     createServer(plugin) → Hono on port 4000+i
     seedFromConfig if YAML block present
3. SIGINT → reset all stores, close servers, remove portless aliases
```

### 3. OAuth in Next.js preview

```
1. app/emulate/[...path]/route.ts → createEmulateHandler({ services: { github, google } })
2. NextAuth provider URLs point to /emulate/github/login/oauth/authorize on same origin
3. Emulator user-picker UI completes code exchange without external network
```

### 4. OpenPhone inbound SMS test

```
1. Seed phone number with sms_url pointing at app webhook
2. POST /_openphone/simulate/inbound-message { To, From, Body }
3. Emulator signs and POSTs message.received to app
```

---

## Build & test

| Script | Command |
|---|---|
| Install | `pnpm install` (Node ≥24, pnpm 11) |
| Build | `turbo build` |
| Test | `turbo test` — Vitest per package |
| Typecheck | `turbo type-check` |

Packages build with `tsup` to `dist/`. CLI `prepack` copies root README into `packages/emulate/`.

---

## Deploy story

**Not deployed.** Distributed as npm package `emulate` and scoped `@emulators/*` workspace
packages. Harper CI references `npx emulate` or imports `createEmulator` from devDependencies.
Fork lives at `Tatch-AI/emulate` with `upstream` pointing to `vercel-labs/emulate`.
