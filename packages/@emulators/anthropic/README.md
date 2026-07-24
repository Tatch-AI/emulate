# @emulators/anthropic

Anthropic Messages API emulation with models, message batches, streaming SSE, tool use, deterministic response seeding, and an inspector for local request logs.

Part of [emulate](https://github.com/vercel-labs/emulate) — local drop-in replacement services for CI and no-network sandboxes.

## Install

```bash
npm install @emulators/anthropic
```

## Endpoints

### Messages
- `POST /v1/messages` — create a message (supports `stream`, tools, thinking, stop sequences)
- `POST /v1/messages/count_tokens` — estimate input tokens

### Models
- `GET /v1/models` — list models (`before_id` / `after_id` / `limit`)
- `GET /v1/models/:id` — retrieve a model (aliases resolve to canonical ids)

### Message Batches
- `POST /v1/messages/batches` — create and process a batch synchronously
- `GET /v1/messages/batches` — list batches
- `GET /v1/messages/batches/:id` — retrieve a batch
- `GET /v1/messages/batches/:id/results` — JSONL results
- `POST /v1/messages/batches/:id/cancel` — cancel a batch
- `DELETE /v1/messages/batches/:id` — delete a finished batch

### Inspector
- `GET /` — tabbed inspector (requests, models, batches, API keys)

## Auth

Send `x-api-key: <key>` and `anthropic-version: 2023-06-01` on every API call. `Authorization: Bearer <key>` is accepted as a fallback. When no `api_keys` are seeded, any key is accepted.

## Seed Configuration

```yaml
anthropic:
  api_keys:
    - sk-ant-test
  models:
    - id: claude-custom
      display_name: Custom Model
  responses:
    - match:
        content_contains: hello
      reply: Hi from the emulator
    - match:
        model: claude-sonnet-4-5
        content_contains: weather
      tool_call:
        name: get_weather
        input: { city: SF }
```

## Official SDK

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: 'sk-ant-test',
  baseURL: 'http://localhost:4000',
})

const message = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'hello' }],
})
```

## Current Limits

Not implemented: Files API, Admin API, prompt caching behavior beyond zeroed cache token fields, citations, web search / computer use / code execution server tools, beta endpoints, and real model inference. Responses are deterministic and matcher-driven for local tests.

## Links

- [Full documentation](https://emulate.dev)
- [GitHub](https://github.com/vercel-labs/emulate)
