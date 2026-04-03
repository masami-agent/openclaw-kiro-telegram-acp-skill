# openclaw-kiro-telegram-acp

Public starter kit for routing Telegram `/kiro` commands through OpenClaw to a downstream Kiro agent over ACP Bridge.

## What this is

This repo documents and packages a practical architecture:

```text
Telegram -> OpenClaw hook -> ACP Bridge -> Kiro CLI agent -> Telegram
```

Use it when you want:

- Telegram users to talk to Kiro with a slash command
- OpenClaw to intercept `/kiro` and suppress the normal assistant reply
- Kiro to own persona, KB, and reasoning
- a clean public example that others can adapt

## Included

- `kiro-telegram-acp.skill` — packaged OpenClaw skill
- `skill-src/` — source of the skill
- `examples/hook-template.ts` — reusable hook template
- `examples/kiro-agent-template.json` — sample Kiro agent config
- `docs/architecture.md` — short architecture walkthrough

## How it works

1. User sends `/kiro ...` in Telegram
2. OpenClaw hook catches the message on `message:received`
3. Hook validates source and strips the `/kiro` prefix
4. Hook POSTs the prompt to a local ACP Bridge endpoint
5. ACP Bridge forwards the request to the configured Kiro agent
6. Hook sends the returned text back to Telegram
7. Hook returns `{ suppress: true }` so OpenClaw does not answer twice

## Recommended design choices

- Keep the hook thin: routing only
- Put language/persona/KB in the Kiro agent definition
- Bind ACP Bridge to localhost
- Restrict to Telegram direct chats
- Add an allowlist if the relay is sensitive

## Prerequisites

You need:

- OpenClaw running with Telegram configured
- a working hook environment in OpenClaw
- ACP Bridge reachable at something like `http://127.0.0.1:7800`
- a Kiro agent exposed by the bridge
- GitHub CLI if you want to publish your own variant

## Install the skill

Option 1: copy the source skill folder into your skills directory.

Option 2: install from the packaged `.skill` file using your preferred OpenClaw skill workflow.

The source skill is under `skill-src/kiro-telegram-acp/`.

## Hook setup

Create a hook similar to `examples/hook-template.ts` and adjust:

- `ACP_BRIDGE_URL`
- target agent name
- allowed chat IDs
- timeout
- reply formatting

Important behavior:

- trigger only on Telegram direct messages
- process only messages starting with `/kiro`
- return `{ suppress: true }`

## Kiro agent setup

Use `examples/kiro-agent-template.json` as a starting point.

Move stable instructions and reusable knowledge into markdown KB files, then point the Kiro agent JSON at those files.

## Public publishing checklist

Before pushing publicly, scrub:

- bot tokens
- personal chat IDs
- private file paths
- account emails
- internal hostnames
- any private KB content

## Troubleshooting

### OpenClaw answers in addition to Kiro

Your hook is likely not returning `{ suppress: true }` for the matched message.

### `/kiro` does nothing

Check:

- hook trigger event is correct
- channel/session filters are not too strict
- ACP Bridge URL is reachable
- target Kiro agent name exists

### Kiro returns but Telegram sees an error

Check Telegram bot token loading and the `sendMessage` API response body.

## Repo structure

```text
.
├── kiro-telegram-acp.skill
├── skill-src/
│   └── kiro-telegram-acp/
├── examples/
│   ├── hook-template.ts
│   └── kiro-agent-template.json
└── docs/
    └── architecture.md
```

## License

MIT
