---
name: kiro-telegram-acp
description: "Relay Telegram /kiro commands to a downstream Kiro agent via OpenClaw hook and ACP. Use when setting up a Telegram-to-Kiro relay, configuring hook-based message routing, or packaging an ACP integration as an OpenClaw skill."
homepage: https://github.com/masami-agent/openclaw-kiro-telegram-acp-skill
metadata:
  {
    "openclaw":
      {
        "emoji": "🤖",
        "requires": { "bins": ["openclaw"] },
        "install":
          [
            {
              "id": "npm",
              "kind": "npm",
              "package": "openclaw",
              "bins": ["openclaw"],
              "label": "Install OpenClaw (npm)",
            },
          ],
      },
  }
---

# Kiro Telegram ACP

## Overview

Implement a lightweight relay pattern: capture `/kiro` commands in an OpenClaw hook, cancel the main assistant reply via `message:sending`, forward the stripped prompt to a Kiro agent, then send the response back to Telegram.

Keep the architecture simple. The hook should route, not think. Put durable behavior in the downstream Kiro agent prompt and knowledge files.

## Recommended Architecture

Use this chain:

1. Telegram direct message starts with `/kiro`
2. OpenClaw hook receives `message:received`
3. Hook validates channel, chat type, and command prefix
4. Hook strips `/kiro` and forwards the remaining prompt through a local ACP client or wrapper
5. The client or wrapper talks to `openclaw acp`, which then calls the target Kiro agent
6. Hook sends the returned text back to Telegram
7. Hook cancels the main OpenClaw reply via `message:sending` hook with `{ cancel: true }`

**Important:** In OpenClaw 2026.4.2, `message:received` is a void hook — its return value is discarded. `{ suppress: true }` does **not** work. To prevent the main agent from replying, use a `message:sending` hook that returns `{ cancel: true }`. As a belt-and-suspenders measure, also instruct the main agent in `SOUL.md` to ignore `/kiro` messages.

This skill is documented for OpenClaw `2026.4.2`, where `openclaw acp` is a stdio bridge rather than an HTTP server.

It is also not a one-shot `ask` CLI, so you should document or provide the ACP client or wrapper layer explicitly.

## Implementation Rules

### 1. Keep the OpenClaw hook narrow

The hook should only do four things:

- detect eligible inbound messages
- normalize the user prompt
- call a local ACP client or wrapper
- send the downstream reply back to Telegram

Do not duplicate business logic, memory, or persona inside the hook unless absolutely necessary.

### 2. Restrict the trigger aggressively

Limit activation to the exact contexts you intend, for example:

- Telegram only
- direct chat only
- message starts with `/kiro`
- optional allowlist of trusted chat IDs

If the command is empty, send a short usage message and still suppress the normal assistant reply.

### 3. Treat Kiro as the reasoning layer

Put these in the Kiro side, not the OpenClaw hook:

- language rules
- domain knowledge
- reusable KB references
- agent persona
- session behavior

For a public skill, keep Kiro resources configurable and avoid hard-coding personal paths when documenting the pattern.

### 4. Prefer async fire-and-forget hook behavior

After dispatching the background handler, return immediately. Use `message:sending` with `{ cancel: true }` to prevent duplicate replies. Never use synchronous blocking calls (`execSync`) inside hook handlers — this freezes the entire gateway.

### 5. Handle failures explicitly

On ACP client, wrapper, or Telegram send failure:

- log the error
- send a short failure notice back to the Telegram chat when possible
- avoid crashing the hook process

Document pairing and scope approval requirements for ACP usage.

## Public Skill Deliverables

When packaging this pattern as a public OpenClaw skill, include:

- `SKILL.md` with the integration workflow and constraints
- `references/architecture.md` describing the end-to-end message flow
- `references/hook-template.ts` with a reusable TypeScript hook example
- `references/kiro-acp-ask.js` with a wrapper contract stub
- `references/kiro-agent-template.json` with a sample Kiro agent definition
- optional public README outside the skill folder if publishing a GitHub repo for humans

Do not put README inside the skill folder. Keep the skill itself minimal and agent-focused.

## Workflow

### Step 1: Define the routing contract

Decide all fixed values up front:

- Telegram scope: direct chat only or broader
- command prefix: usually `/kiro`
- target agent name, such as `kiro`
- response timeout
- wrapper command name or ACP client invocation
- failure message format

### Step 2: Implement the OpenClaw hook

Create a hook with metadata similar to:

- events: `message:received` and `message:sending`
- always: `true`
- purpose: intercept `/kiro` messages and cancel the main assistant reply

The handler should:

1. **On `message:sending`**: if the session has a pending `/kiro` command, return `{ cancel: true }` to block the main agent reply
2. **On `message:received`**: reject non-message, non-Telegram, non-direct events
3. reject content that does not start with `/kiro`
4. strip the prefix and trim whitespace
5. mark the session as pending (for `message:sending` cancellation)
6. call the local ACP client or wrapper asynchronously (never use `execSync`)
7. send the result to Telegram with a `🤖 Kiro` prefix

**Critical:** Do not use `execSync` or any synchronous blocking call inside a hook handler. This will freeze the entire gateway event loop.

**Critical:** `message:received` is a void hook in OpenClaw 2026.4.2. Its return value is discarded. Use `message:sending` with `{ cancel: true }` to suppress the main agent reply.

### Step 3: Configure the Kiro agent

Use a Kiro agent definition JSON to set:

- agent name and description
- language preference
- KB or prompt resource files
- optional MCP compatibility flags

Store stable knowledge in separate markdown files so the Kiro agent can load them consistently.

### Step 4: Document operational constraints

State these explicitly in docs:

- this pattern assumes `openclaw acp` is available locally
- the hook must have permission to talk to Telegram and invoke the local wrapper or ACP client
- `openclaw acp` itself is a bridge, not a one-shot request CLI
- ACP usage may require device pairing and scope approval
- replies are only as safe as the downstream agent prompt and available tools
- public examples must remove personal bot tokens, user IDs, and private file paths

## Reference Files

Read these files when you need concrete examples:

- `references/architecture.md` for a concise architecture summary
- `references/hook-template.ts` for a reusable OpenClaw hook example
- `references/kiro-acp-ask.js` for the wrapper contract stub
- `references/kiro-agent-template.json` for a sample Kiro agent definition

## Validation Checklist

Before publishing or reusing the pattern, verify:

- `/kiro hello` produces one Telegram reply, not two
- non-`/kiro` messages do not trigger the hook
- empty `/kiro` returns a usage hint
- ACP timeout produces a readable error
- pairing failures point users to approval steps
- all personal secrets, IDs, and local paths are replaced with placeholders in public docs

## Alternative Designs

### Option A: OpenClaw hook -> ACP client/wrapper -> `openclaw acp` -> Kiro agent

Use this as the default recommendation for OpenClaw `2026.4.2`.

Pros:

- correct for current transport behavior
- keeps the hook logic simple
- good separation between routing and agent behavior

Cons:

- depends on local OpenClaw ACP availability
- requires an extra wrapper/client component
- requires pairing and scope approval in some environments

### Option B: OpenClaw hook -> custom HTTP wrapper -> `openclaw acp` -> Kiro agent

Use when you intentionally provide your own local HTTP layer on top of ACP.

Pros:

- can simplify integrations that expect HTTP
- may fit other local orchestration systems

Cons:

- adds another component to maintain
- should not be presented as the default OpenClaw behavior

### Option C: Direct CLI execution from a hook

Avoid unless ACP is unavailable.

Cons:

- weaker isolation
- harder error handling
- more fragile process management
- higher chance of duplicated logic

Recommendation: prefer Option A for a public starter pattern on current OpenClaw builds.
