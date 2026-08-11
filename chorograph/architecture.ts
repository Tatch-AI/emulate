// CHOROGRAPH-ARCHITECTURE: this repo's own nodes and edges. TS monorepo — map declared here
// as free-standing doc comments naming implementation paths. Included in per-repo and estate renders.

/**
 * Local drop-in HTTP emulators for third-party APIs: one stateful server per vendor so Harper
 * CI and sandboxes run integration tests without outbound network or live credentials. pnpm
 * monorepo; published as npm `emulate` + `@emulators/*`. Fork of vercel-labs/emulate with
 * Harper-relevant vendors (OpenAI, Anthropic, PostHog, OpenPhone, Knock, Deepgram).
 * @module emulate in:DevEx tech:"TypeScript, Node.js, pnpm, Turborepo" tags:active
 */

/**
 * CLI entry: `npx emulate` starts all or selected vendors from SERVICE_REGISTRY.
 * packages/emulate/src/commands/start.ts
 * @fn emulate-start of:emulate
 * @calls emulate-core spins one Hono server per selected plugin
 */

/**
 * Programmatic test harness: single-vendor lifecycle for Vitest/Jest beforeAll hooks.
 * packages/emulate/src/api.ts → createEmulator()
 * @fn create-emulator of:emulate
 * @calls emulate-core createServer + serve on chosen port
 */

/**
 * Service registry — canonical list of 20 emulated vendors and default seed configs.
 * packages/emulate/src/registry.ts
 * @module emulate-registry of:emulate
 */

/**
 * Shared HTTP server, in-memory Store, auth middleware, webhook dispatcher, plugin contract.
 * packages/@emulators/core/src/server.ts
 * @module emulate-core of:emulate
 */

/**
 * Next.js App Router catch-all to mount emulators on the same origin for stable OAuth callbacks.
 * packages/@emulators/adapter-next
 * @module emulate-adapter-next of:emulate
 */

/**
 * Nuxt server route adapter for same-origin OAuth in preview deployments.
 * packages/@emulators/adapter-nuxt
 * @module emulate-adapter-nuxt of:emulate
 */

// ── Harper-critical vendor emulators (comms, intake, agents, auth) ──

/**
 * Clerk OIDC, users, organizations, sessions — auth for intake and ops UIs.
 * packages/@emulators/clerk/src/index.ts
 * @module emulate-clerk of:emulate
 * @calls Clerk stands in for production Clerk in CI
 */

/**
 * OpenPhone REST: messages, calls, contacts, signed webhooks, inbound simulators.
 * packages/@emulators/openphone/src/index.ts
 * @module emulate-openphone of:emulate
 * @calls OpenPhone intake SMS and call webhook tests without live telephony
 */

/**
 * Twilio 2010 + Messaging + Verify (OTP 123456) + Voice + Conversations.
 * packages/@emulators/twilio/src/index.ts
 * @module emulate-twilio of:emulate
 * @calls Twilio SMS/Verify flows for comms and OTP without carrier delivery
 */

/**
 * Deepgram listen/speak/read APIs and project/key management.
 * packages/@emulators/deepgram/src/index.ts
 * @module emulate-deepgram of:emulate
 * @calls Deepgram call transcription tests with deterministic transcripts
 */

/**
 * OpenAI chat completions, Responses API, embeddings, audio, batches, inspector.
 * packages/@emulators/openai/src/index.ts
 * @module emulate-openai of:emulate
 * @calls OpenAI agent and tooling tests with matcher-driven replies
 */

/**
 * Anthropic Messages API, streaming SSE, token count, message batches.
 * packages/@emulators/anthropic/src/index.ts
 * @module emulate-anthropic of:emulate
 * @calls Anthropic agent tests without live inference
 */

/**
 * Knock workflow triggers, in-app feeds, users, preferences, engagement statuses.
 * packages/@emulators/knock/src/index.ts
 * @module emulate-knock of:emulate
 * @calls Knock notification workflow tests without real email/SMS delivery
 */

/**
 * Slack Web API, OAuth v2, incoming webhooks, event_callback delivery.
 * packages/@emulators/slack/src/index.ts
 * @module emulate-slack of:emulate
 * @calls Slack bot and webhook integration tests for ops and comms
 */

/**
 * Google OAuth 2.0/OIDC plus Gmail, Calendar, and Drive v3 APIs.
 * packages/@emulators/google/src/index.ts
 * @module emulate-google of:emulate
 * @calls Gmail email ingestion and calendar tests without Google Cloud
 */

/**
 * Resend emails, domains, contacts API.
 * packages/@emulators/resend/src/index.ts
 * @module emulate-resend of:emulate
 * @calls Resend transactional email tests without outbound SMTP
 */

// ── Platform, analytics, payments-adjacent ──

/**
 * GitHub REST v3 — repos, issues, PRs, Actions, OAuth, signed webhooks.
 * packages/@emulators/github/src/index.ts
 * @module emulate-github of:emulate
 * @calls GitHub CI and OAuth tests for Platform/DevEx repos
 */

/**
 * Vercel deployments, projects, env vars, blob storage API.
 * packages/@emulators/vercel/src/index.ts
 * @module emulate-vercel of:emulate
 * @calls Vercel deploy and env-var integration tests
 */

/**
 * AWS S3 path-style, SQS, IAM, STS query APIs.
 * packages/@emulators/aws/src/index.ts
 * @module emulate-aws of:emulate
 * @calls S3 upload and SQS message tests without AWS accounts
 */

/**
 * Linear GraphQL, OAuth, issue/comment mutations, webhook delivery.
 * packages/@emulators/linear/src/index.ts
 * @module emulate-linear of:emulate
 * @calls Linear issue-tracking integration tests
 */

/**
 * PostHog capture, decide/flags, feature-flag CRUD, persons/events private API.
 * packages/@emulators/posthog/src/index.ts
 * @module emulate-posthog of:emulate
 * @calls PostHog analytics and feature-flag tests without cloud export
 */

/**
 * MongoDB Atlas Admin v2 and Data API v1.
 * packages/@emulators/mongoatlas/src/index.ts
 * @module emulate-mongoatlas of:emulate
 * @calls MongoDB-Atlas document store tests in DataPlatform services
 */

/**
 * Stripe customers, payment intents, checkout sessions (test double; prod payments use Finix).
 * packages/@emulators/stripe/src/index.ts
 * @module emulate-stripe of:emulate
 * @calls Stripe checkout tests where Stripe SDK is referenced
 */

/**
 * Microsoft Entra ID OIDC and Graph /v1.0/me.
 * packages/@emulators/microsoft/src/index.ts
 * @module emulate-microsoft of:emulate
 * @calls Microsoft-Entra enterprise SSO tests
 */

/**
 * Sign in with Apple OIDC authorize/token/JWKS.
 * packages/@emulators/apple/src/index.ts
 * @module emulate-apple of:emulate
 * @calls Apple-Sign-In consumer auth tests
 */

/**
 * Okta OIDC plus users, groups, apps management API.
 * packages/@emulators/okta/src/index.ts
 * @module emulate-okta of:emulate
 * @calls Okta SSO and directory tests
 */
