---
name: anthropic
description: Emulated Anthropic Messages API for local development and testing. Use when the user needs Claude / Anthropic messages, streaming SSE, tool use, message batches, model listing, token counting, or @anthropic-ai/sdk integration without calling the real Anthropic API. Triggers include "Anthropic API", "emulate Anthropic", "Claude locally", "messages.create", "ANTHROPIC_BASE_URL", "sk-ant", or any task requiring a local Anthropic Messages emulator.
allowed-tools: Bash(npx emulate:*), Bash(emulate:*), Bash(curl:*)
---

# Anthropic Messages API Emulator

Fully stateful Anthropic API emulation. Messages, models, batches, and request logs persist in memory. Responses are deterministic and can be seeded with matchers for text replies or tool calls. No real Anthropic network calls are made.

## Start

```bash
# Anthropic only
npx emulate --service anthropic

# Default port (when run alone)
# http://localhost:4000
```

Or programmatically:

```typescript
import { createEmulator } from 'emulate'

const anthropic = await createEmulator({ service: 'anthropic', port: 4000 })
// anthropic.url === 'http://localhost:4000'
```

## Auth

Pass `x-api-key` and `anthropic-version` on every request. Bearer tokens are accepted as a fallback.

```bash
curl http://localhost:4000/v1/messages \
  -H "x-api-key: sk-ant-test" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-5","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}'
```

When no `api_keys` are seeded, any key is accepted.

## Pointing Your App at the Emulator

### Official SDK

```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: 'sk-ant-test',
  baseURL: process.env.ANTHROPIC_BASE_URL ?? 'http://localhost:4000',
})

const message = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'hello' }],
})
```

### Streaming

```typescript
const stream = await client.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 1024,
  stream: true,
  messages: [{ role: 'user', content: 'hello' }],
})

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text)
  }
}
```

## Seed Config

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
        content_contains: weather
      tool_call:
        name: get_weather
        input:
          city: SF
```

Matchers are checked in order. When none match, the emulator returns a deterministic reply derived from the last user message. When tools are provided and a matcher or `tool_choice` of `any` / `tool` directs it, the response is a `tool_use` block.

## Core Routes

- `POST /v1/messages` - create message (optional `stream: true`)
- `POST /v1/messages/count_tokens` - count input tokens
- `GET /v1/models` - list models
- `GET /v1/models/:id` - get model (aliases resolve)
- `POST /v1/messages/batches` - create batch (processed synchronously)
- `GET /v1/messages/batches/:id/results` - JSONL results
- `GET /` - inspector UI

## Inspector

Browse request logs, models, batches, and API keys:

```
http://localhost:4000/
```

## Current Limits

Files API, Admin API, prompt caching behavior (beyond zeroed cache token fields), citations, web search / computer use / code execution server tools, beta endpoints, and real model inference are not implemented.
