# Deployment Guide

## Goal

Expose a Telegram `/kiro` command that routes into a downstream Kiro agent through OpenClaw using an ACP client stack, with `openclaw acp` acting as the stdio bridge.

## Compatibility

Tested against OpenClaw `2026.4.2`.

Important: in this version, `openclaw acp` is a **stdio bridge**, not an HTTP server and not a one-shot `ask` CLI. Do not build your hook around `http://127.0.0.1:7800` unless you have added your own wrapper, and do not assume `openclaw acp ask ...` exists.

## Minimal stack

- OpenClaw with Telegram configured
- custom hook enabled
- Kiro agent definition JSON
- optional KB markdown files for Kiro
- an ACP client or local wrapper that can talk to `openclaw acp`
- ACP device pairing and approved scopes

## Recommended file layout

```text
~/.openclaw/workspace/
├── hooks/
│   └── kiro-command/
│       ├── HOOK.md
│       └── handler.ts
├── kiro-settings/
│   ├── kiro_default.json
│   ├── kb-preferences.md
│   ├── kb-environment.md
│   └── kb-openclaw.md
```

## Step 1: Create the hook

Create a hook folder and place:

- `HOOK.md`
- `handler.ts`

**Important:** Only place the hook in one location. If the same hook name exists in both `~/.openclaw/hooks/` (managed) and `~/.openclaw/workspace/hooks/` (workspace), the workspace copy is ignored. Having duplicates can cause stale code to run unexpectedly.

Suggested `HOOK.md` pattern:

```md
---
name: kiro-command
description: Relay /kiro commands from Telegram to Kiro agent
metadata:
  openclaw:
    events:
      - message:received
      - message:sending
    always: true
---
```

Use the example `handler.ts` from this repo as the starting point.

**Important:** The hook must listen to both `message:received` (to detect `/kiro`) and `message:sending` (to cancel the main agent reply with `{ cancel: true }`). In OpenClaw 2026.4.2, `message:received` is a void hook — its return value is discarded, so `{ suppress: true }` does not work.

As an additional safety measure, add this line to your `SOUL.md`:

```
If a message starts with `/kiro`, ignore it completely. Do not reply. That command is handled by a separate Kiro agent via a hook.
```

## Step 2: Configure environment values

Set or hard-code only what you must:

- agent name
- allowed Telegram chat IDs
- timeout
- local wrapper command or ACP client invocation

Prefer environment variables for public-friendly deployments.

## Step 3: Create the Kiro agent definition

Start from `examples/kiro-agent-template.json`.

Point the `resources` list at your KB markdown files.

## Step 4: Provide a local ACP wrapper or client

Your Telegram hook usually wants a one-shot request/response function. `openclaw acp` does not provide that interface directly.

You therefore need one of these:

- a local ACP client that can send a single prompt through `openclaw acp`
The hook uses `openclaw agent --session-id <id> --message <prompt> --json` for one-shot agent calls.

Start from:

- `examples/hook-template.ts`

## Step 5: Approve pairing and ACP scopes

A fresh device may only have `operator.read`. That is not enough for ACP usage.

If you see an error like:

```text
GatewayClientRequestError: pairing required
```

approve the latest device request:

```bash
openclaw devices approve --latest
```

Then retry your ACP command.

## Step 6: Enable the hook

After placing the hook under `~/.openclaw/workspace/hooks/`, enable it explicitly:

```bash
openclaw hooks enable kiro-command
```

If the hook exists but remains `⏸ disabled`, it will not process `/kiro` messages.

## Step 7: Test end to end

Send:

```text
/kiro hi
```

Expected behavior:

- Kiro replies once in Telegram
- OpenClaw main assistant does not also reply
- empty `/kiro` returns a short usage hint

## Troubleshooting

### `pairing required`

Your device or client has not been approved for the scopes needed by ACP.

Run:

```bash
openclaw devices approve --latest
```

Then test again.

### Hook detected but disabled

Enable it manually:

```bash
openclaw hooks enable kiro-command
```

### `/kiro` does nothing

Check:

- hook trigger event is `message:received`
- channel and direct-message filters are correct
- the message actually starts with `/kiro`
- allowed chat IDs are correct
- the target Kiro agent name exists
- the hook can successfully invoke your ACP wrapper command
- the wrapper can successfully talk to `openclaw acp`
- the wrapper prints only final reply text to stdout

### OpenClaw replies in addition to Kiro

`message:received` is a void hook in OpenClaw 2026.4.2 — `{ suppress: true }` is silently ignored.

To prevent double replies:

1. Add `message:sending` to your hook events and return `{ cancel: true }` when a `/kiro` command is pending
2. Add an instruction in `SOUL.md` telling the main agent to ignore `/kiro` messages

Also verify there is only one active copy of the hook.

### `openclaw acp ask` is not found

That is expected. `openclaw acp` is a bridge server over stdio. It is not a one-shot prompt CLI.

Use an ACP client or wrapper layer.

### ACP wrapper runs but no useful reply returns

Check:

- target agent name
- prompt serialization
- ACP client request and response handling
- stdio bridge lifecycle
- timeout settings

## Production hardening

- restrict to Telegram direct chats unless group routing is intentional
- add a chat ID allowlist for trusted usage
- log ACP failures clearly
- keep private KB out of public repos
- keep bot tokens out of source code
- document the tested OpenClaw version
