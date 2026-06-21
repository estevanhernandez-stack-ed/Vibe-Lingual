---
name: router
description: This skill should be used when the user says "/vibe-lingual" (bare, no subcommand) or asks "what's next for localization", "where am I with i18n", "should I scan or localize". State-aware next-move recommender for Vibe-Lingual. Reads .vibe-lingual/state/* and recommends the right next step (first-run -> scan, scanned -> audit, audited -> localize). Never auto-fires a mutating step.
---

# /vibe-lingual — state-aware router

Load `vibe-lingual:guide` first. Then read target-app state and route. Routing only — this SKILL never executes a scan, audit, or localize; it recommends and waits for confirmation. The mutating step (localize) is NEVER auto-fired from here.

## State checks (first match wins)

1. **No `.vibe-lingual/state/inventory.json`** → first run.
   - Render the intro (the scan → audit → localize arc, what each does) + "Run `/vibe-lingual:scan` to inventory your UI strings? (read-only, free)."
   - Wait for confirm. If yes, hand off to `scan`. If no, exit.

2. **Inventory exists, no `.vibe-lingual/state/audit.json`** → audit pending.
   - Render the inventory summary (total sites, structural-excluded, files-with-work count, top file by density) + "No audit yet. Run `/vibe-lingual:audit` against the cached inventory? (read-only)."
   - Wait for confirm. If yes, hand off to `audit`.

3. **Audit exists, no writes yet (no `.vibe-lingual/localize/state/extract-ledger.json`)** → localize pending.
   - Render the audit summary: blocker count, the REQUIRED decisions (timeZone above all — it gates localize), ready-vs-blocked file counts.
   - If the REQUIRED timeZone decision is unanswered (no `config.json.decisions.timezone`), lead with it: "Resolve the timeZone decision first — localize will gate on it."
   - Offer: "Run `/vibe-lingual:localize`? It mutates source — confidence-routed (high auto-writes with backup, medium stages, low suggests) and reversible. Recommend a `--dry-run` first."
   - Wait for confirm. NEVER auto-fire localize.

4. **A backup batch exists but staged rewrites are pending** → review-staged branch.
   - Triggered when `.vibe-lingual/localize/staged/` is non-empty.
   - Render the staged file list. Offer: review a staged rewrite, promote one (`/vibe-lingual:localize --apply-staged <file>`), or re-run the loop.
   - Wait for the user to choose.

5. **Extraction has run (ledger exists) + catalogs exist** → guard/translate posture.
   - Read the ledger summary (files written, keys) + the catalog dirs.
   - Surface: which locales are drafted vs marked-untranslated, whether the parity test + jsx-no-literals ratchet are in place. Recommend the next gap (translate the marked locales, or run `/vibe-lingual:localize --phase guard`).
   - If a prior backup batch exists, remind the user `--rollback <batchId>` is available.

6. **All fresh** → full posture summary.
   - Render: top blockers, the decisions' resolved state, the extraction progress (files written / staged / remaining), catalog parity status. Suggest re-running `/vibe-lingual:scan` if a code change pushed new strings since the last scan.

## Workflow

1. `session-logger` start.
2. Read state. Pick the first matching branch.
3. Render the banner.
4. If asking a question, use AskUserQuestion. Wait for the response.
5. If handing off, defer to the target skill.
6. `session-logger` terminal.

## Never

- Run scan, audit, or localize without explicit user confirmation, even on first run.
- Auto-fire the mutating step (localize). The router recommends; the user pulls the trigger.
- Suggest a state-mutating fix from inside the router. Routing only.
