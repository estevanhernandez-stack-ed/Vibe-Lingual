---
name: session-logger
description: Internal SKILL — not a slash command. Two-phase append-only session log for Vibe-Lingual. Invoked by every command SKILL at start (sentinel entry, outcome=in_progress) and at end (terminal entry, paired by sessionUUID). Part of Level 2 (session memory) of the Self-Evolving Plugin Framework. Documentation-only placeholder in v0.1 with a reserved data path.
---

# Session logger (internal · placeholder)

Append-only JSONL log of every command invocation. Two phases: sentinel at start, terminal at end. Paired by `sessionUUID`.

**Status: v0.1 documentation-only placeholder.** The reserved data path is fixed now so the format is stable when the loop is implemented; no implementation ships in v0.1.

## Storage (reserved)

File path: `~/.claude/plugins/data/vibe-lingual/sessions.jsonl`. Create the directory if missing. Append-only — never truncate.

## Sentinel entry shape (written at command start)

```json
{
  "sessionUUID": "<uuid v4>",
  "timestamp": "<ISO 8601>",
  "command": "scan | audit | localize | router | first-run-setup | evolve-lingual",
  "targetApp": "<basename of cwd>",
  "outcome": "in_progress"
}
```

## Terminal entry shape (written at command end)

```json
{
  "sessionUUID": "<same uuid>",
  "timestamp": "<ISO 8601>",
  "command": "...",
  "targetApp": "...",
  "outcome": "completed | aborted | error",
  "durationMs": 0,
  "summary": {
    "sitesCount": null,
    "filesWritten": null,
    "filesStaged": null,
    "framework": null
  }
}
```

## Rules (when implemented)

- Atomic append (open with `a`, single write, close). Never rewrite.
- If a write fails, do NOT abort the command — log to stderr and continue.
- No PII, no source content, no catalog strings. Just shape + counts + UUID.
