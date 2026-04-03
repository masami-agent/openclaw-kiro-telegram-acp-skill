# Wrapper Contract

## Purpose

The Telegram hook in this repo expects a **local one-shot wrapper command**.

Default name:

```bash
kiro-acp-ask
```

The hook calls it like this:

```bash
kiro-acp-ask <agent> <prompt>
```

## Why this exists

On OpenClaw `2026.4.2`, `openclaw acp` is a **stdio ACP bridge server**.
It is not:

- an HTTP endpoint
- a one-shot `openclaw acp ask ...` command

A Telegram hook usually wants request/response behavior, so a thin wrapper is the cleanest bridge.

## Required behavior

Your wrapper must:

1. accept:
   - argv[2] = target agent name
   - argv[3..] = prompt
2. talk to `openclaw acp` using ACP over stdio
3. return only the final assistant text on `stdout`
4. return non-zero on failure
5. write debug/errors to `stderr`

## Hook expectation

The example hook treats wrapper behavior like this:

- `stdout` -> reply text to Telegram
- non-zero exit -> error path
- `stderr` -> diagnostic message if `stdout` is empty

## Recommended implementation options

### Option A — ACP client script

Write a small Node/Python script that:

- spawns `openclaw acp`
- performs ACP `initialize`
- creates or binds a session
- sends the prompt
- waits for the final text output
- prints final text to stdout

### Option B — External ACP client tool

If you already use an ACP client tool that supports one-shot execution, wrap it with a small shell or Node script and preserve the same stdout/stderr contract.

## Exit codes

Suggested convention:

- `0` success
- `1` usage/config error
- `2` ACP transport/session error
- `3` timeout

## Included stub

See:

- `examples/kiro-acp-ask.js`
- `skill-src/kiro-telegram-acp/references/kiro-acp-ask.js`

These are **contract stubs**, not full implementations.
