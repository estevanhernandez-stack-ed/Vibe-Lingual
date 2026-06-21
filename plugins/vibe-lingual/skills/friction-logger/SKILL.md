---
name: friction-logger
description: Internal SKILL — not a slash command. Append-only friction capture for Vibe-Lingual. Invoked by every command SKILL at the documented triggers. Part of Level 2 of the Self-Evolving Plugin Framework. Documentation-only placeholder in v0.1 with a reserved data path.
---

# Friction logger (internal · placeholder)

Append-only JSONL log of friction events. Used by `/vibe-lingual:evolve-lingual` to propose improvements.

**Status: v0.1 documentation-only placeholder.** The reserved data path + the trigger catalog below are fixed now so the format is stable; no implementation ships in v0.1.

## Storage (reserved)

File path: `~/.claude/plugins/data/vibe-lingual/friction.jsonl`. Append-only.

## Entry shape

```json
{
  "timestamp": "<ISO 8601>",
  "sessionUUID": "<from session-logger>",
  "command": "scan | audit | localize | router | first-run-setup",
  "trigger": "<one of the codes below>",
  "confidence": "low | medium | high",
  "context": { "<trigger-specific fields>" }
}
```

## Trigger catalog (the codes the command SKILLs emit)

| Trigger | Source | Confidence | Meaning |
|---|---|---|---|
| `no-recognized-stack` | scan | high | No `package.json` at the resolved root. |
| `inventory-schema-violation` | scan / audit | high | Emitted/read JSON doesn't validate. |
| `scan-mutated-source` | scan | high | A source file changed during a read-only scan. P0. |
| `structural-intl-density-high` | scan | medium | Unusually high share of date-intl flagged structural — possible over-exclusion. |
| `inventory-missing` | audit / localize | high | A downstream command ran without its upstream state. |
| `audit-mutated-source` | audit | high | A source file changed during a read-only audit. P0. |
| `firebase-rule-degraded` | audit | medium | App root unavailable; the firebase-admin SSR rule was skipped (not a clean-surface claim). |
| `empty-inventory-rejected` | audit | high | audit was handed an empty/malformed inventory and failed loud (the M8 hardening fired). |
| `adapter-not-implemented` | localize | high | The detected framework has no implemented adapter; localize refused to mutate. |
| `required-decision-unanswered` | localize | high | The REQUIRED timeZone decision was unanswered while date sites exist; the date surface was held. |
| `auto-write-rolled-back` | localize | high | The user rolled back an auto-applied batch. Tune the auto-write bar. |
| `staged-rewrite-rejected` | localize | medium | A staged rewrite was rejected instead of promoted. Tune confidence routing. |
| `app-test-suite-red-after-extract` | localize | high | The app's own tests went red after extraction (likely a missing provider wrapper). P0. |
| `catalog-merge-conflict` | localize | high | A catalog could not be merged cleanly. |

## Rules (when implemented)

- Atomic append.
- No source content, no catalog strings. Only paths, counts, and trigger codes.
- If a command fires the same trigger multiple times, log once with `context.occurrences`.
- Confidence is set per trigger in this catalog — agents do NOT tune per-call.
