# openclaw-kiro-telegram-acp

Public starter kit for routing Telegram `/kiro` commands through OpenClaw to a downstream Kiro agent through an ACP client stack, with OpenClaw providing the stdio ACP bridge.

## Features

- 🤖 **Telegram `/kiro` command** — talk to a Kiro agent directly from Telegram
- 🔀 **Dual-hook suppression** — `message:received` captures the command, `message:sending` cancels the main agent reply with `{ cancel: true }`
- 🔒 **Chat ID allowlist** — restrict access to trusted Telegram users
- ⚡ **Async non-blocking** — uses `execFile` to avoid freezing the gateway event loop
- 🆔 **Dynamic session IDs** — each query gets a fresh session to avoid stale state
- 🛡️ **Belt-and-suspenders** — SOUL.md instruction as a safety net against double replies
- 📦 **Packaged as OpenClaw skill** — installable via `skill-src/` or ClawHub
- 📝 **Full documentation** — architecture, deployment guide, troubleshooting, and wrapper contract
- 🔧 **Configurable** — agent name, timeout, chat allowlist, reply prefix all adjustable via env vars

## What this is

This repo documents and packages a practical architecture:

```text
Telegram -> OpenClaw hook -> ACP client/wrapper -> openclaw acp (stdio bridge) -> Kiro agent -> Telegram
```

Use it when you want:

- Telegram users to talk to Kiro with a slash command
- OpenClaw to intercept `/kiro` and suppress the normal assistant reply
- Kiro to own persona, KB, and reasoning
- a clean public example that others can adapt

## Compatibility note

This repo is written for OpenClaw `2026.4.2`, where `openclaw acp` behaves as a **stdio JSON-RPC bridge**, not an HTTP server and not a one-shot `ask` command.

That means a Telegram hook cannot treat `openclaw acp` like `curl` or `openclaw acp ask ...`. You need a compatible ACP client or a small local wrapper that speaks ACP over stdio.

## Included

- `kiro-telegram-acp.skill` — packaged OpenClaw skill artifact
- `skill-src/` — source of the skill
- `examples/hook-template.ts` — reusable hook template showing how to call a local wrapper command from OpenClaw
- `examples/kiro-acp-ask.js` — minimal ACP wrapper for one-shot requests via `openclaw acp` stdio bridge
- `examples/kiro-agent-template.json` — sample Kiro agent config
- `docs/architecture.md` — short architecture walkthrough
- `docs/deployment.md` — deployment steps and troubleshooting notes
- `docs/wrapper-contract.md` — the stdout/stderr contract expected by the hook

## How it works

1. User sends `/kiro ...` in Telegram
2. OpenClaw hook catches the message on `message:received`
3. Hook validates source and strips the `/kiro` prefix
4. Hook calls a local ACP-compatible wrapper command
5. The wrapper talks to `openclaw acp` over stdio and forwards the request to the configured Kiro agent
6. Hook sends the returned text back to Telegram
7. Hook cancels the main OpenClaw reply via `message:sending` hook with `{ cancel: true }`

> **Note:** In OpenClaw 2026.4.2, `message:received` is a void hook — `{ suppress: true }` is silently ignored. Use `message:sending` with `{ cancel: true }` instead.

## Recommended design choices

- Keep the hook thin: routing only
- Put language, persona, and KB in the Kiro agent definition
- Restrict to Telegram direct chats
- Add an allowlist if the relay is sensitive
- Handle pairing and scope approval explicitly during setup

## Prerequisites

You need:

- OpenClaw running with Telegram configured
- a working hook environment in OpenClaw
- a Kiro agent reachable through an ACP client that targets `openclaw acp`
- device scopes approved for ACP usage
- GitHub CLI if you want to publish your own variant

## Install the skill

Option 1: copy the source skill folder into your skills directory.

```bash
mkdir -p ~/.openclaw/workspace/skills
cp -R skill-src/kiro-telegram-acp ~/.openclaw/workspace/skills/
```

Option 2: install from the packaged `.skill` file using your preferred OpenClaw skill workflow.

The source skill is under `skill-src/kiro-telegram-acp/`.

## ClawHub publishing and install notes

If you want to publish your own variant to ClawHub:

```bash
clawhub login
clawhub whoami
clawhub publish ./skill-src/kiro-telegram-acp \
  --slug kiro-telegram-acp \
  --name "Kiro Telegram ACP" \
  --version 0.1.0 \
  --changelog "Initial public release"
```

If a published version exists, users can install it with:

```bash
clawhub install kiro-telegram-acp --workdir ~/.openclaw/workspace
```

Or update later with:

```bash
clawhub update kiro-telegram-acp --workdir ~/.openclaw/workspace
```

## Hook setup

Create a hook similar to `examples/hook-template.ts` and adjust:

- target agent name
- allowed chat IDs
- timeout
- wrapper command name
- reply formatting

Important behavior:

- trigger on both `message:received` and `message:sending`
- process only Telegram direct messages starting with `/kiro`
- use `message:sending` with `{ cancel: true }` to block the main agent reply
- never use synchronous blocking calls (`execSync`) inside the handler
- add a `/kiro` ignore instruction to `SOUL.md` as a safety net

## Kiro agent setup

Use `examples/kiro-agent-template.json` as a starting point.

If you want the example hook to run end-to-end, also implement the wrapper contract documented in `docs/wrapper-contract.md`, starting from `examples/kiro-acp-ask.js`.

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

### `/kiro` does nothing

Check:

- hook trigger event is correct
- channel and session filters are not too strict
- allowed chat IDs are correct
- target Kiro agent name exists
- your local ACP wrapper can reach the agent through `openclaw acp`

### `pairing required`

Your device or client likely does not have the scopes needed for ACP usage yet.

Approve the latest device request and retry:

```bash
openclaw devices approve --latest
```

### `openclaw acp ask` is not found

That is expected. `openclaw acp` is a stdio ACP bridge server. It does not provide a built-in one-shot `ask` subcommand.

Use a compatible ACP client or a small wrapper process that speaks ACP over stdio.

### Hook shows as disabled

After installation, enable it explicitly:

```bash
openclaw hooks enable kiro-command
```

### OpenClaw answers in addition to Kiro

`message:received` is a void hook in OpenClaw 2026.4.2 — `{ suppress: true }` is silently ignored.

To prevent double replies:

1. Add `message:sending` to your hook events and return `{ cancel: true }` when a `/kiro` command is pending
2. Add an instruction in `SOUL.md` telling the main agent to ignore `/kiro` messages

Also check that the hook only exists in **one** location.

### Kiro returns but Telegram sees an error

Check Telegram bot token loading and the `sendMessage` API response body.

## Repo structure

```text
.
├── .gitignore
├── package.json
├── tsconfig.json
├── kiro-telegram-acp.skill
├── skill-src/
│   └── kiro-telegram-acp/
│       ├── SKILL.md
│       └── references/
│           ├── architecture.md
│           ├── deployment.md
│           ├── wrapper-contract.md
│           ├── hook-template.ts
│           ├── kiro-acp-ask.js
│           └── kiro-agent-template.json
├── examples/
│   ├── hook-template.ts
│   ├── kiro-acp-ask.js
│   └── kiro-agent-template.json
└── docs/
    ├── architecture.md
    ├── deployment.md
    └── wrapper-contract.md
```

## License

MIT
