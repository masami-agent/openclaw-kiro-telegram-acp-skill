# Installation Guide — openclaw-kiro-telegram-acp Skill

> This document is the single source of truth for installing the `openclaw-kiro-telegram-acp` skill.
> All installation steps are consolidated here. Please follow them in order.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Step 1: Install Dependencies](#step-1-install-dependencies)
- [Step 2: Environment Configuration](#step-2-environment-configuration)
- [Step 3: Build the Project](#step-3-build-the-project)
- [Step 4: Deploy the Hook](#step-4-deploy-the-hook)
- [Step 5: Configure the Kiro Agent](#step-5-configure-the-kiro-agent)
- [Step 6: ACP Device Pairing](#step-6-acp-device-pairing)
- [Step 7: Validation](#step-7-validation)
- [Building the Skill from Source](#building-the-skill-from-source)
- [Known Limitation: Session Isolation](#known-limitation-session-isolation)
- [Troubleshooting: pairing required Error](#troubleshooting-pairing-required-error)
- [Automated Installation (Alternative)](#automated-installation-alternative)

---

## Prerequisites

Before installation, confirm the following three tools are in place. **Order matters**:

| Order | Tool | Command | Purpose | Verification |
|-------|------|---------|---------|--------------|
| 1 | OpenClaw CLI | `openclaw` | Start the ACP stdio bridge, manage hooks and agents | `openclaw --version` |
| 2 | kiro-cli | `kiro` | Kiro agent runtime that receives ACP requests and generates responses | `kiro --version` |
| 3 | Node.js ≥ 18 | `node` | Run hooks, wrapper, and install scripts | `node --version` |

### Check Prerequisites

```bash
# 1. Confirm openclaw is installed
openclaw --version
# Expected: displays version number, e.g. 2026.4.2

# 2. Confirm kiro-cli is installed
kiro --version
# Expected: displays kiro-cli version number

# 3. Confirm Node.js version ≥ 18
node --version
# Expected: v18.x.x or higher
```

> **Important**: `openclaw` must be in place first, as ACP pairing and scope verification both require `openclaw`. `kiro-cli` is the downstream target of the `openclaw acp` bridge — if `kiro` is not in PATH, the ACP bridge cannot establish a connection and the entire skill will not work.

If any tool is missing:

- **OpenClaw**: Refer to the official OpenClaw documentation for installation
- **kiro-cli**: Install from [https://kiro.dev/docs/installation](https://kiro.dev/docs/installation), then confirm `kiro --version` works
- **Node.js**: Download the LTS version (≥ 18) from [https://nodejs.org/](https://nodejs.org/)

---

## Step 1: Install Dependencies

```bash
# Navigate to the project directory
cd openclaw-kiro-telegram-acp

# Install all npm dependencies
npm install
```

**Expected result**: The `node_modules/` directory is created with no errors. The terminal displays the number of installed packages.

---

## Step 2: Environment Configuration

Copy the environment variable template and modify as needed:

```bash
cp .env.example .env
```

Edit the `.env` file and set the following variables:

```dotenv
# Kiro agent name, corresponds to the name field in the agent JSON config
# Default: kiro
KIRO_AGENT_NAME=kiro

# ACP request timeout in milliseconds
# Default: 120000 (2 minutes)
KIRO_TIMEOUT_MS=120000

# ACP Wrapper executable command name
# Default: kiro-acp-ask
KIRO_WRAPPER_CMD=kiro-acp-ask

# Telegram chat ID allowlist for the /kiro command (comma-separated)
# Leave empty for no restrictions
ALLOWED_CHAT_IDS=

# Prefix text for Kiro reply messages
# Default: 🤖 Kiro
KIRO_REPLY_PREFIX=🤖 Kiro

# Debug mode (true/false)
KIRO_DEBUG=false
```

**Expected result**: The `.env` file is created, with at least `KIRO_AGENT_NAME` set to your Kiro agent name.

> For detailed descriptions of each variable, see `.env.example` (path: [.env.example](.env.example)).

---

## Step 3: Build the Project

```bash
npm run build
```

**Expected result**: TypeScript compilation completes, the `dist/` directory contains the corresponding JavaScript files, and the terminal shows no errors.

---

## Step 4: Deploy the Hook

The **only deployment path** for hook files is:

```
~/.openclaw/workspace/hooks/
```

> ⚠️ **Do not** place hooks in `~/.openclaw/hooks/` (managed path). If the same hook name exists in both managed and workspace paths, the workspace copy will be ignored, potentially causing outdated code to run.

### Manual Deployment

```bash
# Create the hook directory
mkdir -p ~/.openclaw/workspace/hooks/kiro-command

# Copy the compiled hook handler
cp dist/hook/handler.js ~/.openclaw/workspace/hooks/kiro-command/handler.ts

# Create the HOOK.md configuration file
cat > ~/.openclaw/workspace/hooks/kiro-command/HOOK.md << 'EOF'
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
EOF
```

### Enable the Hook

```bash
openclaw hooks enable kiro-command
```

**Expected result**: When running `openclaw hooks list`, `kiro-command` shows as enabled (not `⏸ disabled`).

---

## Step 5: Configure the Kiro Agent

### Create the Agent Configuration File

Use `templates/kiro-agent.json` (path: [templates/kiro-agent.json](templates/kiro-agent.json)) as a template to create your agent configuration:

```bash
# Create the kiro-settings directory
mkdir -p ~/.openclaw/workspace/kiro-settings

# Copy the template
cp templates/kiro-agent.json ~/.openclaw/workspace/kiro-settings/kiro_default.json
```

Template contents:

```json
{
  "name": "kiro",
  "description": "Kiro agent for Telegram relay",
  "prompt": "You are a helpful assistant.",
  "resources": [
    "./templates/kb-example.md"
  ],
  "useLegacyMcpJson": true
}
```

### Configure KB Files

Place your Knowledge Base markdown files in the appropriate location and update the paths in the `resources` array. Paths use relative format (starting with `./`), and OpenClaw will resolve them automatically.

For an example KB file, see `templates/kb-example.md` (path: [templates/kb-example.md](templates/kb-example.md)).

**Expected result**: `~/.openclaw/workspace/kiro-settings/kiro_default.json` is created, the `name` field matches `KIRO_AGENT_NAME` in `.env`, and `resources` points to existing KB files.

---

## Step 6: ACP Device Pairing

ACP communication requires completing device pairing and approving the required scopes. An unpaired device may only have `operator.read` permissions, which are insufficient for ACP operations.

### 6.1 Check Current Device Status

```bash
openclaw devices list
```

**Expected result**: Displays the list of registered devices and their status. Confirm whether your device is listed.

### 6.2 Initiate Pairing Request

If the device is not yet paired, run:

```bash
openclaw acp pair
```

**Expected result**: The terminal shows that the pairing request has been sent, awaiting approval.

### 6.3 Approve Device

Approve the latest device request:

```bash
openclaw devices approve --latest
```

**Expected result**: The terminal shows the device has been approved.

### 6.4 Confirm Scopes

Confirm the device has the required scopes for ACP operations:

```bash
openclaw devices list
```

**Expected result**: Your device status shows as approved, and scopes include the permissions required for ACP operations (not just `operator.read`).

> If scopes are insufficient, you may need to re-run the pairing flow or contact an administrator to adjust permissions.

---

## Step 7: Validation

### Automated Validation with Health Checker

```bash
npm run validate
```

The Health Checker will sequentially verify the following items:

1. `kiro-cli` availability
2. `openclaw` CLI availability
3. Hook file exists and is enabled
4. Agent configuration file format is correct
5. ACP Wrapper is executable
6. Environment variables are set
7. ACP device pairing status

**Expected result**: All check items show `✓` passed. If any item fails, the Health Checker will provide specific fix suggestions.

### End-to-End Test

In Telegram, send:

```
/kiro hi
```

**Expected result**:

- Kiro replies with a message (prefixed with `🤖 Kiro`)
- The main OpenClaw agent does **not** reply simultaneously
- Sending an empty `/kiro` (without any text) returns a brief usage hint

---

## Building the Skill from Source

If you need to rebuild the `.skill` file from source (instead of using the pre-packaged version in the repo):

```bash
# 1. Ensure dependencies are installed
npm install

# 2. Compile TypeScript
npm run build

# 3. Build the .skill file
npm run build-skill
```

**Expected result**: The terminal outputs the generated `.skill` file path and size. The built skill file is located in the project root (`kiro-telegram-acp.skill`).

The build process automatically performs:
1. TypeScript compilation
2. Copies compiled JS and resource files to `skill-src/`
3. Packages into a `.skill` file

> The build script source is at `scripts/build-skill.ts` (path: [scripts/build-skill.ts](scripts/build-skill.ts)).

---

## Known Limitation: Session Isolation

### Description

The OpenClaw `message:received` hook mechanism has the following known limitations:

1. **`message:received` hook cannot prevent messages from entering the main agent's context window**. Even if the hook intercepts a `/kiro` message and routes it to Kiro, the message content may still be visible to the main agent and included in its conversation history.

2. **`message:received` is a void hook**. In OpenClaw 2026.4.2, the return value of this hook is discarded; `{ suppress: true }` has no effect.

3. **Sessions may disappear after kiro-cli restarts**. The ACP Wrapper will automatically rebuild the session via `acp/createSession`, but previous conversation memory will start fresh from that point.

4. **All `/kiro` messages within the same chat share a single session** (format: `kiro-telegram-{chatId}`). This is by design to enable cross-message memory. Kiro sessions across different Telegram chats are fully isolated.

### Alternative: SOUL.md Directive

To supplement the insufficient isolation at the hook level, add the following directive to your `SOUL.md`:

```markdown
If a message starts with `/kiro`, ignore it completely. Do not reply. That command is handled by a separate Kiro agent via a hook.
```

This instructs the main agent to ignore `/kiro` messages at the behavioral level, serving as a safety net for the hook mechanism. Even if a `/kiro` message enters the main agent's context, the main agent will not reply to or reference its content.

> **Recommendation**: Use both the `message:sending` hook's `{ cancel: true }` return value and the `SOUL.md` directive for dual-layer protection.

---

## Troubleshooting: pairing required Error

When you see the following error:

```
GatewayClientRequestError: pairing required
```

Or Kiro replies:

```
🔐 Device pairing required. Please refer to the installation guide.
```

Follow these steps to troubleshoot:

### Step 1: Check Device Status

```bash
openclaw devices list
```

Check whether your device is listed and whether its status is approved.

**If the device is not listed**: Pairing has not been performed yet. Continue to Step 2.

**If the device is listed but status is pending**: The pairing request has not been approved yet. Skip to Step 3.

### Step 2: Initiate Pairing Request

```bash
openclaw acp pair
```

**Expected result**: The terminal shows the pairing request has been sent.

### Step 3: Approve Device

```bash
openclaw devices approve --latest
```

**Expected result**: The terminal shows the device has been approved.

### Step 4: Confirm Sufficient Scopes

```bash
openclaw devices list
```

Confirm the device's scopes are not limited to just `operator.read`. ACP operations require additional scope permissions.

**If scopes are insufficient**: You may need to re-run the pairing flow or contact an administrator to adjust permission settings.

### Step 5: Re-test

```bash
# Validate with Health Checker
npm run validate

# Or test directly in Telegram
# Send: /kiro hi
```

**Expected result**: The `pairing required` error no longer appears, and Kiro responds normally.

> If none of the above steps resolve the issue, confirm that the `openclaw` version is 2026.4.2 or a compatible version, and check that the network connection is working properly.

---

## Automated Installation (Alternative)

If you prefer an automated flow, use the built-in interactive install script:

```bash
# First build the install script
npm install
npm run build

# Run the automated installation
npm run install-skill
```

The install script will automatically perform the following:

1. Check `openclaw` CLI availability
2. Check `kiro-cli` availability (stops immediately with install instructions if not found)
3. Check Node.js version ≥ 18
4. Run `npm install`
5. Guide `.env` environment variable setup (with defaults and input prompts)
6. Compile TypeScript
7. Deploy hook to `~/.openclaw/workspace/hooks/`
8. Generate agent config JSON
9. Output installation summary and next steps

**Expected result**: After the install script completes, it displays an installation summary listing completed steps and next actions (such as ACP device pairing).

> If any step fails, the script will stop and output the completed steps along with the failure reason.

---

## Related Documents

| Document | Path | Description |
|----------|------|-------------|
| Architecture Overview | [docs/architecture.md](docs/architecture.md) | End-to-end message flow and system architecture |
| Deployment Guide | [docs/deployment.md](docs/deployment.md) | Detailed deployment steps and troubleshooting (this document is the unified replacement) |
| Wrapper Contract | [docs/wrapper-contract.md](docs/wrapper-contract.md) | ACP Wrapper stdout/stderr contract specification |
| Environment Variable Template | [.env.example](.env.example) | All configurable environment variables with descriptions |
| Agent Config Template | [templates/kiro-agent.json](templates/kiro-agent.json) | Kiro agent JSON configuration template |
| KB Example | [templates/kb-example.md](templates/kb-example.md) | Example Knowledge Base file |
