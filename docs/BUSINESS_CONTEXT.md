# Business Context — emulate

> Part of the Harper estate documentation pass (2026-08). Written for the platform rewrite:
> what this repo means to the brokerage, not just how it works. Technical detail lives in
> [ARCHITECTURE.md](./ARCHITECTURE.md); the live map renders with `npx chorograph render .`.

## Where this sits in the brokerage

Harper's platform talks to dozens of third-party APIs — auth (Clerk), voice and SMS
(OpenPhone, Twilio, Deepgram), LLMs (OpenAI, Anthropic), notifications (Knock, Slack),
email (Gmail via Google, Resend), payments (Stripe), analytics (PostHog), issue tracking
(Linear), cloud primitives (AWS S3/SQS), and more. In production those calls hit real
vendors and cost real money.

**emulate** is Harper's local, stateful stand-in for those APIs during **CI pipelines** and
**no-network sandboxes**. It is not a mock library that stubs one function at a time — each
emulator is a real HTTP server that speaks the vendor's wire format (REST, GraphQL, OAuth
flows, webhooks) so application code runs unchanged with only a base-URL swap.

In brokerage terms: emulate does not touch premium, policies, or commissions. It sits in
**DevEx / Platform**, enabling engineers and agents to test intake flows (voice transcription,
SMS OTP), agent tooling (LLM completions), comms (Slack, Knock, OpenPhone), and auth
(Clerk) without live credentials or outbound network access. The list of emulated vendors is
itself a **dependency map** of what the estate considers critical enough to fake locally.

## Emulated APIs (estate dependency index)

Twenty services are registered in `packages/emulate/src/registry.ts` (default ports
4000–4019). Each row is a third-party Harper code may call in prod; emulate is the offline
twin.

| Service key | Real vendor | Default port | Harper domains that use it |
|---|---|---:|---|
| `clerk` | Clerk | 4011 | Auth across intake, sales, ops UIs |
| `openphone` | OpenPhone | 4017 | Intake — business phone, SMS, call webhooks |
| `twilio` | Twilio | 4013 | Communications — SMS, Verify OTP, Voice, Conversations |
| `deepgram` | Deepgram | 4019 | Intake — speech-to-text on calls |
| `openai` | OpenAI | 4014 | AgentsPlatform — chat, embeddings, audio, batches |
| `anthropic` | Anthropic | 4015 | AgentsPlatform — Messages API, streaming, tools |
| `knock` | Knock | 4018 | Communications — in-app + email notification workflows |
| `slack` | Slack | 4003 | Communications / InternalOps — bots, OAuth, webhooks |
| `google` | Google (OAuth + Gmail, Calendar, Drive) | 4002 | Communications (Gmail), calendar integrations |
| `resend` | Resend | 4008 | Communications — transactional email API |
| `posthog` | PostHog | 4016 | Acquisition / product analytics, feature flags |
| `stripe` | Stripe | 4009 | Money (adjacent) — payment intents, checkout (Harper prod uses Finix; Stripe emulator supports tests) |
| `github` | GitHub | 4001 | Platform / DevEx — repos, Actions, OAuth, webhooks |
| `vercel` | Vercel | 4000 | Platform — deploy previews, env vars, blob |
| `aws` | AWS (S3, SQS, IAM, STS) | 4007 | Platform — object storage, queues in tests |
| `linear` | Linear | 4012 | InternalOps — issue tracking GraphQL + OAuth |
| `mongoatlas` | MongoDB Atlas | 4010 | DataPlatform — Atlas Admin + Data API in tests |
| `microsoft` | Microsoft Entra ID | 4005 | Auth — enterprise SSO |
| `apple` | Apple Sign In | 4004 | Auth — consumer SSO |
| `okta` | Okta | 4006 | Auth — OIDC + management API |

**Not emulated here (but appear elsewhere in the estate):** Finix (payments-service),
Anvil (forms), ISC/carrier portals, Customer.io, HubSpot, Temporal, Kafka/Relay — those
require separate test doubles or contract tests.

## Who and what depends on it

- **Harper service test suites** — Vitest/Jest setups call `createEmulator()` from the
  `emulate` npm package or run `npx emulate --service <name>` in CI before integration tests.
- **Next.js / Nuxt apps** — `@emulators/adapter-next` and `@emulators/adapter-nuxt` mount
  emulators on the same origin so OAuth callback URLs stay stable in preview deployments.
- **Engineers on calls** — not directly; emulate is invisible to agents. It unblocks shipping
  features that *do* touch OpenPhone, Clerk, etc. without flaky live API calls in CI.
- **Upstream:** forked from [vercel-labs/emulate](https://github.com/vercel-labs/emulate);
  Tatch-AI/emulate adds Harper-relevant vendors (OpenAI, Anthropic, PostHog, OpenPhone,
  Knock, Deepgram per recent commits).

## Domain concepts

| Concept | Meaning |
|---|---|
| Service plugin | One `@emulators/<vendor>` package implementing `ServicePlugin` — routes + in-memory store |
| Seed config | YAML/JSON (`emulate.config.yaml`) preloading users, OAuth apps, API keys, sample data |
| Store | `@emulators/core` typed in-memory `Collection<T>` — state survives until `reset()` |
| Webhook dispatcher | Delivers signed outbound webhooks to URLs registered by the app under test (Slack events, GitHub hooks, OpenPhone `message.delivered`, etc.) |
| Inspector UI | `GET /` on each emulator — tabbed view of auth, messages, deliveries for debugging |
| `createEmulator()` | Programmatic API: one HTTP server per vendor for test `beforeAll` / `afterAll` lifecycle |

## Operational status (2026-07 estate forensics)

**Active.** Weekly velocity on the Tatch-AI fork; upstream sync from vercel-labs. Published as
the `emulate` npm package (v0.9.0). Tier-2 DevEx tooling — not load-bearing in prod runtime,
but load-bearing for **CI confidence** on anything that integrates the vendors above.

## Rewrite notes — what must survive

1. **Vendor fidelity over breadth** — tests trust wire-format compatibility (OAuth code flow,
   webhook signatures, pagination shapes). A rewrite of Harper services should keep pointing
   integration tests at emulate (or a successor) rather than hand-rolled mocks.
2. **The registry is the contract** — `SERVICE_REGISTRY` in `registry.ts` is the canonical
   list of supported vendors; adding a new Harper third-party dependency should add an
   emulator here (or document why not).
3. **Stateful, seedable responses** — LLM emulators use matcher rules (`content_contains:
   ping` → `pong`); Verify uses fixed OTP `123456`. Determinism in CI is an invariant.
4. **No secrets in seed defaults** — default API keys are obviously fake (`sk-test-openai`,
   `op_test_api_key`). Never commit real vendor credentials in seed files.
5. **Gap vs production:** Stripe is emulated but Harper payments prod-core is Finix
   (payments-service). PostHog is emulated; estate may also use other analytics. Document
   new vendors in the registry table when Harper adopts them.
