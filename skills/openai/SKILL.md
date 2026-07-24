---
name: openai
description: Emulated OpenAI API for local development and testing. Use when the user needs chat completions, Responses API, embeddings, audio transcription/speech, moderations, files, batches, or official openai SDK integration without hitting the real OpenAI service. Triggers include "OpenAI API", "emulate OpenAI", "chat completions locally", "OPENAI_BASE_URL", "responses.create", or any task requiring a local OpenAI-compatible API.
allowed-tools: Bash(npx emulate:*), Bash(emulate:*), Bash(curl:*)
---

# OpenAI API Emulator

Fully stateful OpenAI API emulation. Chat completions, Responses, embeddings, models, audio, moderations, files, and batches persist in memory. Replies are deterministic and seedable so tests stay stable.

No real OpenAI calls are made. Point the official `openai` SDK at the emulator with `baseURL`.

## Start

```bash
# OpenAI only
npx emulate --service openai

# Default port (when run alone)
# http://localhost:4000
```

Or programmatically:

```typescript
import { createEmulator } from 'emulate'

const openai = await createEmulator({ service: 'openai', port: 4000 })
// openai.url === 'http://localhost:4000'
```

## Auth

Pass tokens as `Authorization: Bearer <token>`. When no `api_keys` are seeded, any Bearer token is accepted.

```bash
curl http://localhost:4000/v1/models \
  -H "Authorization: Bearer sk-test-key"
```

## Pointing Your App at the Emulator

### Official openai SDK

```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: 'sk-test-key',
  baseURL: 'http://localhost:4000/v1',
})

const completion = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hello' }],
})
```

### Environment Variable Pattern

Many apps read a base URL from env. Set it to the emulator:

```bash
OPENAI_BASE_URL=http://localhost:4000/v1
OPENAI_API_KEY=sk-test-key
```

## Seed Config

```yaml
openai:
  api_keys:
    - sk-test-key
  models:
    - custom-model
  responses:
    - match:
        content_contains: hello
      reply: Hi from emulate
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
    - contains: banned
      categories: [hate, violence]
```

## API Endpoints

### Chat Completions

```bash
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hello"}]}'
```

Supports `stream`, `tools` / `tool_choice`, `response_format` (`json_object`, `json_schema`), `n`, and seedable reply matchers.

### Responses

```bash
curl -X POST http://localhost:4000/v1/responses \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","input":"hello"}'
```

### Embeddings

```bash
curl -X POST http://localhost:4000/v1/embeddings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"text-embedding-3-small","input":"hello"}'
```

Embeddings are deterministic for identical inputs and L2-normalized.

### Files and Batches

Upload a JSONL batch input file with purpose `batch`, then create a batch. The emulator processes requests synchronously and writes an output JSONL file.

```bash
curl -X POST http://localhost:4000/v1/batches \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input_file_id":"file-...","endpoint":"/v1/chat/completions","completion_window":"24h"}'
```

### Inspector

Browse request logs, models, files, batches, and API keys:

```
http://localhost:4000/
```

## Current Limits

Realtime WebSocket API, Assistants API, fine-tuning jobs, image generation, vector stores, and exact production token accounting are not implemented. Completions are deterministic and seedable. Batches complete synchronously on create.
