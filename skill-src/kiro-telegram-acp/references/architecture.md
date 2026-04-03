# Architecture Summary

This reference describes a Telegram `/kiro` relay pattern for OpenClaw `2026.4.2`.

## Message flow

```text
Telegram
  -> OpenClaw hook (`message:received`)
  -> `/kiro` filter and prompt normalization
  -> local ACP client or wrapper
  -> `openclaw acp` stdio bridge
  -> downstream Kiro agent
  -> Telegram reply
  -> `message:sending` hook returns `{ cancel: true }` to block main agent
```

## Design rules

- keep the hook thin
- keep persona and KB in Kiro
- limit routing to Telegram direct chats unless broader scope is intentional
- add an allowlist if the relay should be restricted
- handle pairing and timeout failures with readable user-facing messages
- do not present `openclaw acp` as an HTTP endpoint or one-shot `ask` CLI
