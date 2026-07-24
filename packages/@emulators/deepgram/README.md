# @emulators/deepgram

Deepgram API emulator for local development and CI. Part of [emulate](https://github.com/vercel-labs/emulate).

Fully stateful, production-fidelity emulation of Deepgram prerecorded transcription, text to speech, text intelligence, temporary auth tokens, and the management API (projects, keys, usage). Not mocks.

```bash
npm install @emulators/deepgram
```

Run it through the CLI:

```bash
npx emulate --service deepgram
```

## Auth

Canonical form:

```text
Authorization: Token <api_key>
```

Also accepts `Authorization: Bearer <token>` for temporary tokens from `POST /v1/auth/grant`, and for API keys (leniency). When no API keys are seeded, any credential is accepted.

Default seeded key (plugin seed): `deepgram_test_key`

## Endpoints

### Listen (prerecorded)
- `POST /v1/listen` — URL JSON body or raw audio bytes; query params for model, language, punctuate, smart_format, diarize, utterances, paragraphs, summarize, topics, intents, sentiment, detect_language, multichannel/channels, callback, and more

### Speak (TTS)
- `POST /v1/speak` — JSON `{ "text": "..." }`; returns audio bytes with `dg-request-id`, `dg-model-name`, `dg-model-uuid`, `dg-char-count`

### Read (text intelligence)
- `POST /v1/read` — JSON `{ "text" }` or `{ "url" }`; summarize, topics, sentiment, intents

### Auth
- `POST /v1/auth/grant` — issue temporary access tokens (`ttl_seconds` 1–3600, default 30)

### Management
- `GET/PATCH/DELETE /v1/projects` and `/v1/projects/:id`
- `GET/POST/DELETE /v1/projects/:id/keys` (and get one)
- `GET /v1/projects/:id/members`
- `GET /v1/projects/:id/requests`
- `GET /v1/projects/:id/usage`

### Inspector
- `GET /` — transcription requests, TTS, projects/keys, temp tokens, callback deliveries

## Seed Configuration

```yaml
deepgram:
  projects:
    - name: Default
      company: Acme
  api_keys:
    - deepgram_test_key
    - key: custom_key
      project: Default
      scopes: [member, usage:write]
      comment: ci
  transcripts:
    - match:
        url_contains: spacewalk
      text: We choose to go to the moon.
      duration: 12
      speakers: 1
    - text: Default transcript for other audio.
  read:
    - match:
        text_contains: billing
      text: placeholder
      summary: Customer asked about billing.
  speak:
    model: aura-2-thalia-en
```

## SDK

With `@deepgram/sdk` v5:

```typescript
import { DeepgramClient } from '@deepgram/sdk'

const client = new DeepgramClient({
  apiKey: 'deepgram_test_key',
  baseUrl: 'http://localhost:4000',
})

await client.listen.v1.media.transcribeUrl({
  url: 'https://example.com/audio.wav',
  model: 'nova-3',
})
```

## Current Limits

- No WebSocket live transcription (`/v1/listen` streaming)
- No Agent API or Voice Agent websocket
- No self-hosted distribution endpoints
- No balances, invoices, or billing
- Audio is not decoded; duration is seeded or estimated from transcript length
- TTS returns deterministic fake WAV/MP3 bytes, not real synthesis
- Callback delivery is best-effort local HTTP POST with a `dg-token` header

## Links

- [Full documentation](https://emulate.dev)
- [GitHub](https://github.com/vercel-labs/emulate)
