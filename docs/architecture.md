# Architecture Summary

## Purpose

Expose a downstream Kiro agent to Telegram users through OpenClaw without making the main assistant answer `/kiro` messages.

## Compatibility

This architecture is documented for OpenClaw `2026.4.2`, where `openclaw acp` is used as a **stdio JSON-RPC bridge**.

It is not a one-shot request CLI. A hook needs an ACP client or wrapper layer in front of it.

## End-to-End Flow

```text
Telegram user
  -> OpenClaw inbound message event
  -> custom hook checks `/kiro` prefix
  -> hook strips prefix and validates source
  -> hook calls a local ACP client or wrapper
  -> wrapper talks to `openclaw acp` over stdio
  -> Kiro agent generates response
  -> hook sends response back to Telegram
  -> hook cancels the normal OpenClaw reply via `message:sending` + `{ cancel: true }`
```

## Responsibilities by Layer

### Telegram

- carries user messages and final replies
- does not know about Kiro directly

### OpenClaw hook

- acts as a router
- owns trigger filtering and suppression
- should not contain heavy agent logic

### `openclaw acp`

- bridges an ACP client to the configured downstream agent
- communicates over stdin/stdout rather than a local HTTP port
- depends on device pairing and sufficient scopes

### ACP client or wrapper

- translates the hook's one-shot request into ACP protocol messages
- manages stdio lifecycle for `openclaw acp`
- returns final text back to the hook

### Kiro agent

- owns language, persona, KB loading, and domain behavior
- should be configured via agent JSON plus KB markdown files

## Security Boundaries

- restrict to direct chats unless group routing is intentional
- prefer an allowlist for trusted users if the relay is sensitive
- keep bot tokens and personal paths out of public examples
- do not assume ACP is reachable unless the device has been paired and approved

## Failure Modes

- ACP client or wrapper unavailable -> return a short Telegram error
- `openclaw acp` used like a one-shot CLI -> document the limitation clearly
- pairing or scope failure -> document approval steps and return a readable error
- Telegram send failure -> log locally
- empty command -> return usage text
- duplicate replies -> use `message:sending` hook with `{ cancel: true }` (note: `message:received` is a void hook — `{ suppress: true }` is ignored)
