---
name: kiro-telegram-acp
description: Build and document an OpenClaw integration that relays Telegram commands to a Kiro CLI agent through ACP Bridge. Use when creating or explaining a setup where Telegram messages pass through an OpenClaw hook into an ACP Bridge HTTP endpoint and then into a Kiro agent, including hook design, message suppression, agent prompts, knowledge-base files, safety boundaries, and public packaging as an OpenClaw skill.
---

# Kiro Telegram ACP

## Overview

Implement a lightweight relay pattern: capture `/kiro` commands in an OpenClaw hook, suppress the main assistant reply, forward the stripped prompt to a local ACP Bridge endpoint, then send the downstream agent response back to Telegram.

Keep the architecture simple. The hook should route, not think. Put durable behavior in the downstream Kiro agent prompt and knowledge files.

## Recommended Architecture

Use this chain:

1. Telegram direct message starts with `/kiro`
2. OpenClaw hook receives `message:received`
3. Hook validates channel, chat type, and command prefix
4. Hook strips `/kiro` and forwards the remaining prompt to ACP Bridge
5. ACP Bridge calls the target Kiro agent
6. Hook sends the returned text back to Telegram
7. Hook returns `{ suppress: true }` so the main OpenClaw assistant stays silent for that message

Use a fixed local ACP Bridge URL by default, such as `http://127.0.0.1:7800`.

## Implementation Rules

### 1. Keep the OpenClaw hook narrow

The hook should only do four things:

- detect eligible inbound messages
- normalize the user prompt
- call the ACP Bridge endpoint
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

### 4. Prefer fire-and-forget hook behavior

After dispatching the background handler, return `{ suppress: true }` immediately. This avoids duplicate replies and keeps OpenClaw responsive.

### 5. Handle failures explicitly

On ACP Bridge or Telegram send failure:

- log the error
- send a short failure notice back to the Telegram chat when possible
- avoid crashing the hook process

## Public Skill Deliverables

When packaging this pattern as a public OpenClaw skill, include:

- `SKILL.md` with the integration workflow and constraints
- `references/architecture.md` describing the end-to-end message flow
- `references/hook-template.ts` with a reusable TypeScript hook example
- `references/kiro-agent-template.json` with a sample Kiro agent definition
- optional public README outside the skill folder if publishing a GitHub repo for humans

Do not put README inside the skill folder. Keep the skill itself minimal and agent-focused.

## Workflow

### Step 1: Define the routing contract

Decide all fixed values up front:

- Telegram scope: direct chat only or broader
- command prefix: usually `/kiro`
- ACP Bridge base URL
- target agent name, such as `kiro`
- response timeout
- failure message format

### Step 2: Implement the OpenClaw hook

Create a hook with metadata similar to:

- event: `message:received`
- always: `true`
- purpose: intercept `/kiro` messages before the main assistant responds

The handler should:

1. reject non-message events
2. reject non-Telegram traffic
3. reject non-direct sessions if required
4. reject content that does not start with `/kiro`
5. strip the prefix and trim whitespace
6. call the ACP Bridge endpoint
7. send the result to Telegram
8. return `{ suppress: true }`

### Step 3: Configure the Kiro agent

Use a Kiro agent definition JSON to set:

- agent name and description
- language preference
- KB or prompt resource files
- optional MCP compatibility flags

Store stable knowledge in separate markdown files so the Kiro agent can load them consistently.

### Step 4: Document operational constraints

State these explicitly in docs:

- this pattern assumes a locally reachable ACP Bridge
- the hook must have permission to talk to Telegram and the bridge
- replies are only as safe as the downstream agent prompt and available tools
- public examples must remove personal bot tokens, user IDs, and private file paths

## Reference Files

Read these files when you need concrete examples:

- `references/architecture.md` for a concise architecture summary
- `references/hook-template.ts` for a reusable OpenClaw hook example
- `references/kiro-agent-template.json` for a sample Kiro agent definition

## Validation Checklist

Before publishing or reusing the pattern, verify:

- `/kiro hello` produces one Telegram reply, not two
- non-`/kiro` messages do not trigger the hook
- empty `/kiro` returns a usage hint
- ACP Bridge timeout produces a readable error
- all personal secrets, IDs, and local paths are replaced with placeholders in public docs

## Alternative Designs

### Option A: OpenClaw hook -> ACP Bridge HTTP -> Kiro CLI

Use this as the default recommendation.

Pros:

- minimal moving parts in OpenClaw
- easy to reason about
- good separation between routing and agent behavior

Cons:

- depends on a local HTTP bridge service

### Option B: OpenClaw ACP session spawn instead of custom hook

Use when you want OpenClaw to own the downstream ACP lifecycle more directly.

Pros:

- more native to OpenClaw session management
- easier to extend into persistent ACP threads

Cons:

- not as lightweight for a simple `/kiro` relay
- may require more OpenClaw-specific orchestration

### Option C: Direct CLI execution from a hook

Avoid unless ACP Bridge is unavailable.

Cons:

- weaker isolation
n- harder error handling
- more fragile process management
- higher chance of duplicated logic

Recommendation: prefer Option A for a public starter pattern.
