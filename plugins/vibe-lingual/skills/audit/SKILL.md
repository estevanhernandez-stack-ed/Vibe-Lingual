---
name: audit
description: This skill should be used when the user says "/vibe-lingual:audit", "audit my i18n readiness", "what will bite me when I localize", "check for i18n gotchas", or wants per-file readiness + a phased localization plan. Reads .vibe-lingual/state/inventory.json, applies the gotcha rules (firebase-admin-ssr, structural-intl, timezone, rtl, dynamic-route-glob), and writes .vibe-lingual/state/audit.json + a dated audit report. Read-only.
---

# /vibe-lingual:audit — gotcha + readiness analysis

Load `vibe-lingual:guide` first for the i18n-retrofit persona and posture.

Surface the retrofit traps before any code moves. Audit reads the cached scan inventory, applies the five gotcha rules, surfaces the per-app decisions the plugin must NOT auto-resolve, classifies each file ready-or-blocked, and lays out the phased plan. This is the middle step of the scan → audit → localize arc — still read-only. `localize` is the only mutating step, and it sits behind both scan and audit.

## Prerequisite

`.vibe-lingual/state/inventory.json` must exist (produced by `/vibe-lingual:scan`). Audit reads the cached inventory — it does NOT re-scan. If the inventory is missing, instruct the user to run `/vibe-lingual:scan` first and exit.

## Inputs

- **Cached inventory:** `.vibe-lingual/state/inventory.json` in the target app — REQUIRED.
- **Target app root:** the inventory's `app.root`, or the current working directory. The root enables the one source-dependent rule (firebase-admin-in-SSR reads the SSR files the inventory named). Resolve to an absolute path before invoking the engine.
- No flags.

## What it touches (read-only contract)

- **Reads:** `.vibe-lingual/state/inventory.json`, and — for the firebase-admin-SSR rule only — the App Router `page.tsx`/`layout.tsx` source the inventory already listed under `app.ssrFiles`. Never executes app code, never hits the network.
- **Writes (inside the target app, never source):**
  - `.vibe-lingual/state/audit.json` — the machine-readable audit.
  - `docs/vibe-lingual/audit-YYYY-MM-DD.md` — the human-readable report.
- **Never mutates target source.** Same inviolable contract as scan. If a run would touch a source file, that is a bug — abort and friction-log it.

## The five gotcha rules

| Rule | Source | Severity | What it catches |
|---|---|---|---|
| `firebase-admin-ssr` | reads SSR file source | **block** | a `firebase-admin` import in an App Router `page.tsx`/`layout.tsx`. firebase-admin is banned in Turbopack SSR (safe only in `functions/`) — a locale loader must NOT mount there. |
| `structural-intl` | inventory (excluded sites) | info | the scan-time structural `Intl` exclusions, restated as an audit-time CONFIRM-before-extract gate. Extracting them corrupts logic (KTD-5). |
| `timezone` | inventory (presentational date sites) | warn | each presentational locale-sensitive date whose `useFormatter` rewrite needs a timeZone choice. Pairs with a REQUIRED `timezone` decision. |
| `rtl` | app-level | info | the layout assumes LTR. Flag before adding Arabic / Hebrew / Urdu. |
| `dynamic-route-glob` | inventory (`app.ssrFiles`) | warn | App Router `[param]` segment dirs. ESLint flat-config treats `[param]` as a minimatch char class — a literal-path guard entry SILENTLY never matches. The guard must glob with `*`. |

## Decisions the audit SURFACES (never auto-resolves)

- **`timezone` (REQUIRED).** Fires whenever any presentational date site exists. Client-rendered local dates want the browser zone (a global fixed tz shifts dates a day for distant viewers); SSR dates need an explicit tz. Too consequential to auto-pick — the plugin surfaces it as a choice with a recommendation, and `localize` will block on it.
- **`dual-locale` (optional).** Fires when the app already declares a locale preference (`existingI18n.localePref`). If that pref controls AI/content OUTPUT, UI locale (`uiLanguage`) must be modeled SEPARATELY — the two do not move in lockstep.
- **`html-lang` (optional).** Fires when an App Router layout exists. `<html lang="en">` should become `lang={locale}` (async layout + `getLocale()`).

## Workflow

1. **Pre-flight.** Invoke `session-logger` (sentinel start entry). Read `.vibe-lingual/state/inventory.json`. If missing, tell the user to run `/vibe-lingual:scan` first and exit cleanly. Validate the inventory against `plugins/vibe-lingual/schemas/inventory.schema.json` — if invalid, friction-log `inventory-schema-violation` and abort (audit is only as good as the inventory it reads).

2. **Resolve the app root.** Use the inventory's `app.root`. The audit engine reads the SSR file source from this root for the firebase-admin rule; the other four rules run from the inventory alone. If the root no longer exists, the firebase-admin rule degrades (skips, never guesses) — note that in the banner rather than claiming a clean firebase surface.

3. **Compute the dated paths.** Today's date in `YYYY-MM-DD` (UTC, for stable filenames). Audit path: `.vibe-lingual/state/audit.json`. Report path: `docs/vibe-lingual/audit-<date>.md`. Both relative to the target app root.

4. **Run the engine.** From the plugin's `engine/` directory:
   ```bash
   node engine/cli.mjs audit <appRoot> \
     --inventory <appRoot>/.vibe-lingual/state/inventory.json \
     --audit <appRoot>/.vibe-lingual/state/audit.json \
     --report <appRoot>/docs/vibe-lingual/audit-<date>.md
   ```
   The CLI reads the cached inventory (no re-scan), applies the rules, and writes both files (it `mkdir -p`s parents). It prints a one-line summary to stderr: gotcha counts by severity, files blocked / ready, and required-decision count. Capture that line.

5. **Confirm the audit validates.** Read back `.vibe-lingual/state/audit.json` and sanity-check it against `plugins/vibe-lingual/schemas/audit.schema.json`:
   - Required top-level keys: `schemaVersion` (must be `1`), `gotchas`, `decisions`, `readiness`, `phasedPlan`.
   - Each gotcha `type` ∈ {`firebase-admin-ssr`,`structural-intl`,`timezone`,`rtl`,`dynamic-route-glob`}; `severity` ∈ {`block`,`warn`,`info`}.
   - Each decision `id` ∈ {`timezone`,`dual-locale`,`html-lang`}.
   - Each phasedPlan `phase` ∈ {`extract`,`wire`,`translate`,`wire-to-locale`,`guard`}, in that order.
   - If validation fails, do NOT surface a report — report the violation and stop.

6. **Confirm no source was mutated.** The engine is read-only by construction; verify the contract held. Only the two output paths should be new/changed. If the target is a git repo, `git status --short` should show nothing outside `.vibe-lingual/state/audit.json` and the dated report. Anything else is a P0 — friction-log `audit-mutated-source` and surface it loudly.

7. **Surface the report.** Read the dated report and present it. It carries four sections, every gotcha named with its file, every decision tagged REQUIRED-or-optional:
   - **Gotchas** — grouped by severity (BLOCK → WARN → INFO). Lead with blockers: a firebase-admin SSR import stops a locale loader cold.
   - **Decisions to make** — the timeZone choice (REQUIRED), plus dual-locale and html-lang when they apply. State the recommendation but do NOT pick for the user on the required one.
   - **Per-file readiness** — the ready/blocked table. Blocked-first. Each blocked file says exactly why (firebase-admin import, or dynamic-route glob).
   - **Phased plan** — extract → wire → translate → wire-to-locale → guard, sized to this app, naming the blockers to clear and the existing language list to reuse.

8. **Render the banner.** ≤ 20 lines. Lead with the blocker count and the REQUIRED decisions (those gate `localize`), end with the next move.

9. **Post-flight.** `session-logger` terminal entry.

## Banner template

```
═══ Vibe-Lingual audit ═══
App:        <appRoot>

Gotchas:    5 total — 1 block · 2 warn · 2 info
Blocker:    firebase-admin in src/app/admin/page.tsx (no locale loader here)
Decisions:  1 REQUIRED (timeZone) · 2 optional (dual-locale, html-lang)
Readiness:  2 blocked (admin/page.tsx, s/[shareId]/page.tsx) · 3 ready

Audit:      .vibe-lingual/state/audit.json
Report:     docs/vibe-lingual/audit-2026-06-21.md

Next: resolve the REQUIRED timeZone decision, then /vibe-lingual:localize.
```

## Next step

Recommend resolving the REQUIRED decisions (timeZone above all) and then `/vibe-lingual:localize`. Localize reads both the cached `inventory.json` AND this `audit.json`: it honors the readiness (won't wire a locale loader into a firebase-admin SSR file, globs dynamic-route guards with `*`), and it will not proceed on the date surface until the timeZone decision is answered. Audit is read-only — localize is the only mutating step, gated behind confidence routing + per-file backups.

## Friction triggers

See the family `friction-triggers` convention. Highlights:
- `inventory-missing` — no cached inventory; user must run scan first. Confidence: high.
- `inventory-schema-violation` — the cached inventory does not validate. Confidence: high.
- `audit-schema-violation` — the engine emitted audit JSON that doesn't validate. Confidence: high.
- `audit-mutated-source` — a source file changed during a read-only audit. P0. Confidence: high.
- `firebase-rule-degraded` — the app root was unavailable, so the firebase-admin SSR rule was skipped (not a clean-surface claim). Confidence: medium — note it in the banner.

## Never

- Re-scan from within audit. Audit reads the cached inventory; scan owns the inventory. If the inventory is stale, tell the user to re-run scan.
- Mutate any target source file. Extraction belongs to `localize`, behind confidence routing + backups.
- Auto-resolve the timeZone decision. It is a REQUIRED per-app choice — surface it with a recommendation, never silently pick (a wrong global tz shifts dates by a day for distant viewers).
- Auto-include or "fix" a structural `Intl` site. The structural-intl gotcha is a CONFIRM gate, not a to-do — extracting it corrupts logic (KTD-5).
- Run app code or hit the network. The audit is inventory analysis + a guarded SSR-source read.
