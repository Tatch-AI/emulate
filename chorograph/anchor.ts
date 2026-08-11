// CHOROGRAPH-ANCHOR: swapped out by the estate-wide render (cooked/estate-map). Shared/stub declarations only.
//
// emulate stands in for third-party HTTP APIs in CI and sandboxes — it does not call them.
// Externals below are the production vendors Harper services integrate with; this anchor
// declares them so per-repo maps can edge to the canonical names.

/**
 * Harper is an AI-forward commercial insurance brokerage. Revenue is commission on placed
 * premium; the platform runs the funnel from lead acquisition through intake, quoting and
 * placement, binding, payment, post-bind servicing, and renewal.
 * @system Harper
 */

/**
 * Developer experience: SDKs, local tooling, agentic dev infrastructure, and test harnesses.
 * @domain DevEx
 */

/**
 * Platform infrastructure, deployment, and shared operational tooling.
 * @domain Platform
 */

/**
 * Voice intake, telephony, and call-adjacent integrations.
 * @domain Intake
 */

/**
 * Agent runtimes, LLM providers, and orchestration adjacent to Atlas/Hermes.
 * @domain AgentsPlatform
 */

/**
 * Communications email, SMS, phone, Slack, and notification delivery.
 * @domain Communications
 */

/**
 * Lead gen, marketing, and product analytics adjacent to acquisition funnels.
 * @domain Acquisition
 */

/**
 * Payments, billing, and premium money movement.
 * @domain Money
 */

/**
 * Internal dashboards, ops UIs, and admin tooling.
 * @domain InternalOps
 */

/**
 * Centralized data ingestion, storage, and enrichment.
 * @domain DataPlatform
 */

/**
 * Auth and identity for Harper apps and customer-facing surfaces.
 * @external Clerk in:Intake
 */

/**
 * Business phone system — SMS, calls, transcripts for intake workflows.
 * @external OpenPhone in:Communications
 */

/**
 * Programmable SMS, voice, Verify OTP, and Conversations.
 * @external Twilio in:Communications
 */

/**
 * Speech-to-text and text-to-speech on recorded or live audio.
 * @external Deepgram in:Intake
 */

/**
 * Chat completions, embeddings, audio, and batch APIs for agents.
 * @external OpenAI in:AgentsPlatform
 */

/**
 * Messages API, streaming, and tool use for agents.
 * @external Anthropic in:AgentsPlatform
 */

/**
 * Multi-channel notification workflows (in-app, email).
 * @external Knock in:Communications
 */

/**
 * Workspace bots, OAuth apps, and incoming webhooks.
 * @external Slack in:Communications
 */

/**
 * OAuth, Gmail, Calendar, and Drive APIs.
 * @external Gmail in:Communications
 */

/**
 * Transactional email send API.
 * @external Resend in:Communications
 */

/**
 * Product analytics, feature flags, and event capture.
 * @external PostHog in:Acquisition
 */

/**
 * Payment intents, checkout sessions, customers (test double; prod uses Finix).
 * @external Stripe in:Money
 */

/**
 * Repositories, Actions, OAuth, and GitHub App webhooks.
 * @external GitHub in:Platform
 */

/**
 * Deployments, projects, environment variables, and blob storage.
 * @external Vercel in:Platform
 */

/**
 * S3 object storage, SQS queues, IAM, and STS.
 * @external S3 in:Platform
 */

/**
 * Issue tracking GraphQL API and OAuth.
 * @external Linear in:InternalOps
 */

/**
 * Atlas Admin API and Data API for document stores in tests.
 * @external MongoDB-Atlas in:DataPlatform
 */

/**
 * Enterprise SSO — Entra ID OAuth and Microsoft Graph /me.
 * @external Microsoft-Entra in:Platform
 */

/**
 * Sign in with Apple OIDC.
 * @external Apple-Sign-In in:Platform
 */

/**
 * OIDC provider and user/group/app management API.
 * @external Okta in:Platform
 */
