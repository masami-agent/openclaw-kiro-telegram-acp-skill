# openclaw-kiro-telegram-acp

Relay user messages from Telegram via the `/kiro` command through the OpenClaw ACP bridge to a downstream Kiro agent, and send the reply back to Telegram.

```text
Telegram → OpenClaw Hook → ACP Wrapper → openclaw acp (stdio bridge) → Kiro Agent → Telegram
```

## Features

- 🤖 **Telegram `/kiro` command** — Chat with the Kiro agent directly in Telegram
- 🔀 **Dual reply suppression** — `message:received` intercepts the command, `message:sending` cancels the main agent reply with `{ cancel: true }`
- 🧠 **Cross-message memory** — `/kiro` conversations within the same chat share a fixed session, allowing Kiro to remember previous context
- 🔒 **Chat ID allowlist** — Restrict access to trusted Telegram users only
- 🛡️ **Error message formatting** — JSON-RPC errors, provider errors, and ACP permission errors are converted to user-friendly messages
- ⚡ **Async non-blocking** — Uses `execFile` to avoid freezing the gateway event loop
- 📦 **OpenClaw Skill packaging** — Installable via `skill-src/` or ClawHub
- 🔧 **Environment variable configuration** — Agent name, timeout, chat allowlist, and reply prefix are all configurable via `.env`

## Quick Start

For complete installation steps, see **[INSTALL.md](INSTALL.md)**.

If you prefer an automated flow, use the built-in interactive install script:

```bash
npm install
npm run build
npm run install-skill
```

After installation, run validation:

```bash
npm run validate
```

## Compatibility Notes

This project is developed for OpenClaw `2026.4.2`, where `openclaw acp` is a **stdio JSON-RPC bridge** (not an HTTP server, nor a one-shot `ask` command).

## Project Structure

```text
.
├── INSTALL.md                      # Unified installation guide (single source of truth)
├── .env.example                    # Environment variable template
├── src/
│   ├── hook/handler.ts             # OpenClaw Hook handler
│   ├── wrapper/kiro-acp-ask.ts     # ACP Wrapper implementation
│   └── lib/                        # Core modules (config, error-formatter, etc.)
├── scripts/                        # Automation scripts (install, validate, build-skill)
├── templates/                      # Agent config and KB templates
├── skill-src/                      # Skill source code (for packaging)
├── docs/                           # Architecture, deployment, wrapper contract docs
└── examples/                       # Example files
```

## Related Documents

| Document | Description |
|----------|-------------|
| [INSTALL.md](INSTALL.md) | Unified installation guide — prerequisites, environment setup, hook deployment, ACP pairing, validation |
| [docs/architecture.md](docs/architecture.md) | End-to-end message flow and system architecture |
| [docs/wrapper-contract.md](docs/wrapper-contract.md) | ACP Wrapper stdout/stderr contract specification |
| [docs/deployment.md](docs/deployment.md) | Deployment steps and troubleshooting |
| [.env.example](.env.example) | All configurable environment variables with descriptions |
| [templates/kiro-agent.json](templates/kiro-agent.json) | Kiro agent JSON configuration template |

## License

MIT
