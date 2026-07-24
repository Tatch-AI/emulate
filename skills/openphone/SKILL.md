---
name: openphone
description: Emulated OpenPhone (Quo) REST APIs for local development and testing. Use when the user needs to test OpenPhone SMS, calls, contacts, phone numbers, signed webhooks, inbound message or call simulation, or OpenPhone API integrations without hitting the real OpenPhone service.
allowed-tools: Bash(npx emulate:*)
---

# OpenPhone API Emulator

Stateful OpenPhone REST emulation with seeded API keys, users, phone numbers, messages, calls, contacts, signed webhooks, local simulator routes, and an inspector.

## Start

```bash
npx emulate --service openphone
```

Default URL: `http://localhost:4000` when OpenPhone is the only service.

## Defaults

```text
OPENPHONE_API_KEY=op_test_api_key
OPENPHONE_PHONE_NUMBER=+15551234567
OPENPHONE_PHONE_NUMBER_ID=PN00000000
OPENPHONE_USER_ID=US00000000
```

## Auth

Send the API key in the `Authorization` header without a Bearer prefix:

```text
Authorization: op_test_api_key
```

`Authorization: Bearer op_test_api_key` is also accepted. When no API keys are seeded, any non-empty key is accepted.

## Core Routes

- `POST /v1/messages` - send outbound message
- `GET /v1/messages` - list messages (`phoneNumberId` + `participants`)
- `GET /v1/calls` - list calls
- `GET /v1/call-recordings/{callId}` - list recordings
- `GET /v1/call-summaries/{callId}` - get summary
- `GET /v1/call-transcripts/{callId}` - get transcript
- `POST /v1/contacts` / `GET|PATCH|DELETE /v1/contacts/{id}` - contacts CRUD
- `GET /v1/phone-numbers` - list workspace numbers
- `POST /v1/webhooks/messages|calls|call-summaries|call-transcripts` - create webhooks
- `POST /_openphone/simulate/inbound-message` - simulate inbound SMS
- `POST /_openphone/simulate/inbound-call` - simulate inbound call
- `POST /_openphone/simulate/call-recording|call-summary|call-transcript` - attach call artifacts

## SMS And Call Testing

- Outbound `POST /v1/messages` creates a delivered message and fires `message.delivered` webhooks with `openphone-signature`.
- Use `POST /_openphone/simulate/inbound-message` to fire `message.received`.
- Use `POST /_openphone/simulate/inbound-call` to fire `call.ringing` then `call.completed`.
- Attach recordings, summaries, and transcripts through the matching `/_openphone/simulate/*` routes.

## Current Limits

No real telephony, carrier delivery, MMS/media upload, user management writes, conversations endpoints, tasks, or complete production OpenPhone billing and compliance behavior is implemented.
