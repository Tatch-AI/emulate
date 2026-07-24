# @emulators/openai

OpenAI API emulation with chat completions, Responses API, embeddings, models, audio, moderations, files, and batches. Fully stateful and seedable for CI and no-network sandboxes.

Part of [emulate](https://github.com/vercel-labs/emulate) — local drop-in replacement services for CI and no-network sandboxes.

## Install

```bash
npm install @emulators/openai
```

## Endpoints

### Chat Completions
- `POST /v1/chat/completions` — chat completions (streaming and non-streaming, tools, JSON response formats)

### Responses
- `POST /v1/responses` — Responses API (streaming and non-streaming)
- `GET /v1/responses/:id` — retrieve a stored response
- `DELETE /v1/responses/:id` — delete a stored response

### Embeddings
- `POST /v1/embeddings` — deterministic embeddings (`float` or `base64`)

### Models
- `GET /v1/models` — list models
- `GET /v1/models/:id` — get model

### Audio
- `POST /v1/audio/transcriptions` — multipart transcription
- `POST /v1/audio/translations` — multipart translation
- `POST /v1/audio/speech` — binary speech synthesis

### Moderations
- `POST /v1/moderations` — content moderation

### Files
- `POST /v1/files` — upload file
- `GET /v1/files` — list files
- `GET /v1/files/:id` — get file
- `GET /v1/files/:id/content` — download file content
- `DELETE /v1/files/:id` — delete file

### Batches
- `POST /v1/batches` — create and process a batch synchronously
- `GET /v1/batches` — list batches
- `GET /v1/batches/:id` — get batch
- `POST /v1/batches/:id/cancel` — cancel an in-progress batch

### Inspector
- `GET /` — tabbed inspector for request log, models, files, batches, and API keys

## Auth

Pass `Authorization: Bearer <key>`. When no `api_keys` are seeded, any Bearer token is accepted. When keys are seeded, only those keys are valid. Missing auth returns OpenAI's `invalid_api_key` error envelope.

Organization and project headers (`OpenAI-Organization`, `OpenAI-Project`) are accepted and echoed. Responses include `x-request-id`.

## Seed Configuration

```yaml
openai:
  api_keys:
    - sk-test-key
  models:
    - my-fine-tuned-model
  responses:
    - match:
        model: gpt-4o-mini
        content_contains: hello
      reply: Hi from the emulator
    - match:
        content_contains: weather
      reply: ""
      tool_call:
        name: get_weather
        arguments: '{"city":"SF"}'
  transcripts:
    - filename_contains: meeting
      text: Seeded meeting transcript
  moderation_triggers:
    - contains: banned-word
      categories: [hate, violence]
```

## Pointing the Official SDK

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-test-key",
  baseURL: "http://localhost:4000/v1",
});
```

## Current Limits

Realtime WebSocket API, Assistants API (threads/runs), fine-tuning jobs, image generation/edits/variations, vision image understanding beyond accepting multipart content parts, vector stores, and exact production token accounting / rate limits are not implemented. Completions are deterministic and seedable rather than model-inferred. Batch jobs are processed synchronously on create.

## Links

- [Full documentation](https://emulate.dev)
- [GitHub](https://github.com/vercel-labs/emulate)
