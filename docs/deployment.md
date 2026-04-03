# Deployment Guide

## Goal

Expose a Telegram `/kiro` command that routes into a downstream Kiro agent through OpenClaw and ACP Bridge.

## Minimal stack

- OpenClaw with Telegram configured
- custom hook enabled
- ACP Bridge running on localhost
- Kiro agent definition JSON
- optional KB markdown files for Kiro

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

Suggested `HOOK.md` pattern:

```md
---
name: kiro-command
description: Relay /kiro commands from Telegram to Kiro CLI via ACP Bridge
metadata:
  openclaw:
    events:
      - message:received
    always: true
---
```

Use the example `handler.ts` from this repo as the starting point.

## Step 2: Configure environment values

Set or hard-code only what you must:

- ACP bridge URL
- agent name
- allowed Telegram chat IDs
- timeout

Prefer environment variables for public-friendly deployments.

## Step 3: Create the Kiro agent definition

Start from `examples/kiro-agent-template.json`.

Point the `resources` list at your KB markdown files.

## Step 4: Start ACP Bridge

Run your ACP Bridge so that the hook can call an endpoint like:

```text
POST http://127.0.0.1:7800/agents/kiro/ask
```

The exact bridge startup command depends on your ACP Bridge installation.

## Step 5: Test end to end

Send:

```text
/kiro hi
```

Expected behavior:

- Kiro replies once in Telegram
- OpenClaw main assistant does not also reply

## Production hardening

- bind bridge to localhost only
- add chat ID allowlist
- log failures clearly
- keep private KB out of public repos
- keep bot tokens out of source code
