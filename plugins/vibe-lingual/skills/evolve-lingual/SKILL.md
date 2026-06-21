---
name: evolve-lingual
description: This skill should be used when the user says "/vibe-lingual:evolve-lingual" and wants Vibe-Lingual to reflect on past sessions and propose improvements to itself. L3 self-evolution loop. Reads ~/.claude/plugins/data/vibe-lingual/ session + friction logs, weights findings, writes proposed SKILL/rule/template edits to docs/proposed-changes.md in the Vibe-Lingual solo repo. Never auto-applies. Documentation-only placeholder in v0.1.
---

# /vibe-lingual:evolve-lingual (placeholder)

Reflect on the last N days of Vibe-Lingual usage and propose changes to the plugin itself.

**Status: v0.1 documentation-only placeholder.** The data paths + the shape below are fixed now; no implementation ships in v0.1. The loop never auto-applies — output is always a diff proposal for human review (the vibe-taker / vibe-walk pattern).

## Inputs (reserved)

- `~/.claude/plugins/data/vibe-lingual/sessions.jsonl`
- `~/.claude/plugins/data/vibe-lingual/friction.jsonl`
- `~/.claude/plugins/data/vibe-lingual/wins.jsonl` (if it exists)
- Default window: last 30 days. CLI arg `--days N` overrides.

All command skills (scan, audit, localize, router, first-run-setup) contribute to these logs.

## Workflow (when implemented)

1. **Pre-flight.** session-logger start. If `sessions.jsonl` has zero entries in the window, friction-log `no-sessions-in-30-days` and exit.
2. **Weight friction.** Group by trigger code across all commands. Score: `count × confidenceWeight` where `{high:3, medium:2, low:1}`.
3. **Surface patterns.** Top 5 triggers by score. For each, identify the SKILL / rule / template to revise, and the source command.
4. **Propose changes.** Write `docs/proposed-changes.md` in the Vibe-Lingual solo repo (NOT the target app — this proposes changes to the plugin). One section per pattern: trigger code + count + score + source; affected file; concrete prose diff; self-confidence.
5. **Banner.** ≤ 20 lines, top 3 patterns, path to `proposed-changes.md`.
6. **Post-flight.** session-logger terminal.

## Likely change targets (anticipated mappings)

| Trigger pattern | Maps to |
|---|---|
| `structural-intl-density-high` clustering | `engine/scan.mjs` structural-vs-presentational classifier (KTD-5) |
| `auto-write-rolled-back` clustering | `localize/SKILL.md` confidence routing + the file-confidence aggregation in `engine/extract.mjs` |
| `adapter-not-implemented` clustering on one framework | candidate to implement that adapter (lift a `_stubs/` entry to real) |
| `app-test-suite-red-after-extract` | the test-harness-collateral step (the `NextIntlClientProvider` wrapper automation) |
| `required-decision-unanswered` | the decision interview gates in `first-run-setup` + `localize` |

## Rules

- **Never auto-apply.** Output is always a diff proposal for human review.
- Respect the absence-of-friction inference: a SKILL that fires zero friction in 30 days of regular use is a positive signal — don't propose changes to working SKILLs.
- If a pattern's score is below 5 (low signal), include it but flag it low-confidence.
