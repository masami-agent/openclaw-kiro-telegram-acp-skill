# Architecture Summary

## Purpose

Expose a downstream Kiro agent to Telegram users through OpenClaw without making the main assistant answer `/kiro` messages.

## End-to-End Flow

```text
Telegram user
  -> OpenClaw inbound message event
  -> custom hook checks `/kiro` prefix
  -> hook strips prefix and validates source
  -> hook POSTs prompt to ACP Bridge
  -> ACP Bridge forwards to Kiro agent
  -> Kiro agent generates response
  -> hook sends response back to Telegram
  -> hook suppresses the normal OpenClaw reply
```

## Responsibilities by Layer

### Telegram

- carries user messages and final replies
- does not know about Kiro directly

### OpenClaw hook

- acts as a router
- owns trigger filtering and suppression
- should not contain heavy agent logic

### ACP Bridge

- exposes a local HTTP interface for downstream agent calls
- decouples OpenClaw from direct CLI lifecycle management

### Kiro agent

- owns language, persona, KB loading, and domain behavior
- should be configured via agent JSON plus KB markdown files

## Security Boundaries

- restrict to direct chats unless group routing is intentional
- prefer an allowlist for trusted users if the endpoint is sensitive
- keep bot tokens and personal paths out of public examples
- bind ACP Bridge to localhost unless remote access is intentionally required

## Failure Modes

- bridge unavailable -> return a short Telegram error
- Telegram send failure -> log locally
- empty command -> return usage text
- duplicate replies -> verify the hook returns `{ suppress: true }`
