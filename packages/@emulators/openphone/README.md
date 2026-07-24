# @emulators/openphone

OpenPhone (Quo) API emulator for local development and CI. Part of [emulate](https://github.com/vercel-labs/emulate).

```bash
npm install @emulators/openphone
```

Run it through the CLI:

```bash
npx emulate --service openphone
```

Stateful REST emulation of OpenPhone messages, calls (read + simulator), contacts, phone numbers, signed webhooks, local simulator routes, and an inspector. Auth uses the raw API key in the `Authorization` header (Bearer is also accepted).

Default local credentials:

```text
OPENPHONE_API_KEY=op_test_api_key
OPENPHONE_PHONE_NUMBER=+15551234567
OPENPHONE_PHONE_NUMBER_ID=PN00000000
OPENPHONE_USER_ID=US00000000
```

Point clients at the emulator base URL instead of `https://api.openphone.com`. Example:

```bash
curl "$OPENPHONE_EMULATOR_URL/v1/phone-numbers" \
  -H "Authorization: $OPENPHONE_API_KEY"
```

## Endpoints

### Messages
- `POST /v1/messages` - send outbound SMS (transitions to delivered and fires `message.delivered`)
- `GET /v1/messages` - list messages (`phoneNumberId` + `participants` required)
- `GET /v1/messages/{id}` - get message

### Calls
- `GET /v1/calls` - list calls (`phoneNumberId` + `participants` required)
- `GET /v1/calls/{callId}` - get call
- `GET /v1/call-recordings/{callId}` - list recordings (also `/v1/calls/{callId}/recordings`)
- `GET /v1/call-summaries/{callId}` - get AI summary
- `GET /v1/call-transcripts/{callId}` - get transcript

### Contacts
- `POST /v1/contacts` - create contact
- `GET /v1/contacts` - list contacts (`externalIds`, `sources`, pagination)
- `GET /v1/contacts/{id}` - get contact
- `PATCH /v1/contacts/{id}` - update contact
- `DELETE /v1/contacts/{id}` - delete contact
- `GET /v1/contact-custom-fields` - list custom field definitions

### Phone numbers
- `GET /v1/phone-numbers` - list workspace numbers
- `GET /v1/phone-numbers/{phoneNumberId}` - get number

### Webhooks
- `POST /v1/webhooks/messages`
- `POST /v1/webhooks/calls`
- `POST /v1/webhooks/call-summaries`
- `POST /v1/webhooks/call-transcripts`
- `GET /v1/webhooks`
- `GET /v1/webhooks/{id}`
- `DELETE /v1/webhooks/{id}`

Deliveries use the OpenPhone `openphone-signature` header (`hmac;1;<timestamp>;<signature>`).

### Simulator
- `POST /_openphone/simulate/inbound-message`
- `POST /_openphone/simulate/inbound-call`
- `POST /_openphone/simulate/call-recording`
- `POST /_openphone/simulate/call-summary`
- `POST /_openphone/simulate/call-transcript`

### Inspector
- `GET /` - tabbed inspector for messages, calls, contacts, phone numbers, webhooks, and API keys

## Seed Configuration

```yaml
openphone:
  api_keys:
    - key: op_test_api_key
      name: Local API Key
  users:
    - id: US00000000
      first_name: Local
      last_name: Owner
      email: owner@example.com
      role: owner
  phone_numbers:
    - id: PN00000000
      number: "+15551234567"
      name: Local OpenPhone Number
      users: [owner@example.com]
  custom_fields:
    - key: lead-score
      name: Lead Score
      type: number
  contacts:
    - external_id: crm-1
      source: crm
      default_fields:
        firstName: Casey
        lastName: Lee
  webhooks:
    - url: http://localhost:3000/webhooks/openphone
      type: messages
      events: [message.received, message.delivered]
      resourceIds: ["*"]
  calls:
    - participants: ["+15550001111"]
      duration: 60
      recording:
        url: http://localhost/recording.mp3
      summary:
        summary: ["Discussed pricing"]
        nextSteps: ["Send proposal"]
```

## Current Limits

No real telephony, carrier delivery, MMS/media upload, user management writes, conversations endpoints, tasks, voicemail media hosting, or production OpenPhone billing and compliance behavior is implemented. Calls, recordings, summaries, and transcripts are created through seed config or `/_openphone/simulate/*` routes.
