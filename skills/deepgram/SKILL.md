---
name: deepgram
description: Emulated Deepgram speech AI API for local development and testing. Use when the user needs prerecorded transcription, text to speech, text intelligence, temporary auth tokens, Deepgram projects/keys/usage, or SDK integrations without hitting the real Deepgram service. Triggers include "Deepgram API", "emulate Deepgram", "transcribe locally", "Deepgram listen", "Deepgram speak", "DEEPGRAM_API_KEY", or any task requiring a local speech API.
allowed-tools: Bash(npx emulate:*), Bash(emulate:*), Bash(curl:*)
---

# Deepgram API Emulator

Stateful Deepgram API emulation. Prerecorded listen, speak (TTS), read (text intelligence), auth grant tokens, projects/keys/members/usage, callback deliveries, and an inspector all persist in memory.

No real speech models run. Transcripts and summaries come from seed matchers or deterministic defaults. TTS returns synthetic audio bytes.

## Start

```bash
npx emulate --service deepgram
```

Default URL when Deepgram is the only service: `http://localhost:4000`

## Auth

```text
Authorization: Token <api_key>
```

Also accepts `Bearer` for temporary tokens from `/v1/auth/grant` and for API keys. When no keys are seeded, any credential is accepted.

Default seeded key: `deepgram_test_key`

```bash
curl -X POST http://localhost:4000/v1/listen \
  -H "Authorization: Token deepgram_test_key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/audio.wav"}'
```

## Pointing Your App at the Emulator

### @deepgram/sdk v5

```typescript
import { DeepgramClient } from '@deepgram/sdk'

const deepgram = new DeepgramClient({
  apiKey: process.env.DEEPGRAM_API_KEY ?? 'deepgram_test_key',
  baseUrl: process.env.DEEPGRAM_BASE_URL ?? 'http://localhost:4000',
})

const { result } = await deepgram.listen.v1.media.transcribeUrl({
  url: 'https://example.com/audio.wav',
  model: 'nova-3',
  punctuate: true,
})
```

### Direct fetch

```bash
curl -X POST "$DEEPGRAM_BASE_URL/v1/speak?model=aura-2-thalia-en&container=wav" \
  -H "Authorization: Token deepgram_test_key" \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from emulate"}' \
  --output out.wav
```

## Seed Config

```yaml
deepgram:
  projects:
    - name: Default
  api_keys:
    - deepgram_test_key
  transcripts:
    - match:
        url_contains: spacewalk
      text: We choose to go to the moon.
      duration: 12
    - text: Default transcript.
  read:
    - match:
        text_contains: refund
      summary: Customer wants a refund.
  speak:
    model: aura-2-thalia-en
```

## Core Routes

- `POST /v1/listen` — prerecorded transcription (URL JSON or raw audio)
- `POST /v1/speak` — text to speech
- `POST /v1/read` — text intelligence
- `POST /v1/auth/grant` — temporary access token
- `GET /v1/projects` — list projects
- `GET /v1/projects/:id/keys` — list keys
- `POST /v1/projects/:id/keys` — create key (secret returned once)
- `GET /v1/projects/:id/requests` — request log
- `GET /v1/projects/:id/usage` — usage summary
- `GET /` — inspector UI

## Callback Async Transcription

```bash
curl -X POST "http://localhost:4000/v1/listen?callback=https://hooks.example/dg" \
  -H "Authorization: Token deepgram_test_key" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/audio.wav"}'
# => {"request_id":"..."}
```

The emulator POSTs the full transcription result to the callback URL with a `dg-token` header. Deliveries appear in the inspector Callbacks tab.

## Current Limits

No WebSocket live transcription, Agent API, self-hosted endpoints, balances/invoices, or real audio decoding. Duration is seeded or estimated. TTS audio is synthetic.
