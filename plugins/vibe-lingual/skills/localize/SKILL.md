---
name: localize
description: This skill should be used when the user says "/vibe-lingual:localize", "localize my app", "extract my strings to next-intl", "wire up i18n", or wants to run the mutating localization loop. Reads inventory.json + audit.json + the matched adapter, then runs extract -> wire -> translate -> guard with confidence routing (high auto-write+backup / medium stage / low inline-only), per-file backup + rollback, and idempotent re-runs. Mutates the target — confidence-routed and reversible.
---

# /vibe-lingual:localize — the mutating loop

Load `vibe-lingual:guide` first for the i18n-retrofit persona and posture.

This is the third and final step of the scan → audit → localize arc, and the ONLY one that touches source. It runs the five-phase loop — **extract → wire framework → translate → wire-to-locale → guard** — driving the deterministic engine for the mechanical work and surfacing the soft decisions (timeZone, dual-locale) as interview gates. Confidence-routed like the sibling `/vibe-prompt:remediate` and `/vibe-sec:fix`: high-confidence files auto-write (backed up first), medium stages for review, low is a suggestion only. Every write is reversible by timestamped batch.

## Prerequisites

| Input | Required | Notes |
|---|---|---|
| `.vibe-lingual/state/inventory.json` | REQUIRED | Produced by `/vibe-lingual:scan`. The string-site source of truth. |
| `.vibe-lingual/state/audit.json` | REQUIRED | Produced by `/vibe-lingual:audit`. Its readiness GATES auto-write (blocked files never get written) and its REQUIRED timeZone decision gates the date surface. |
| `.vibe-lingual/config.json` | OPTIONAL | Produced by `/vibe-lingual:first-run-setup`. Carries the framework + adapter + resolved decisions. Absent → run first-run-setup first (the loop invokes it). |
| A matched adapter | REQUIRED | The registry must resolve an implemented adapter for the detected framework. v1 implements next-intl (App Router) only — a non-match means localize REFUSES to mutate and reports `not-yet-implemented` cleanly (KTD-3). |

If `inventory.json` or `audit.json` is missing, tell the user to run `/vibe-lingual:scan` then `/vibe-lingual:audit` first, and exit. Never re-scan or re-audit from inside localize.

## Flags

| Flag | Effect |
|---|---|
| `--dry-run` | Plan + route every file, write NOTHING. The preview gate — run this first on any real app. |
| `--rollback <ISO-timestamp>` | Restore a prior backup batch (exact byte-for-byte). Accepts the raw ISO timestamp or the safe batch id. |
| `--stage-all` | Route every file to staging regardless of confidence (the cautious first pass — even high-confidence files stage). Backed by the engine (`extract … --stage-all`); a blocked file still stays inline-only (the audit gate wins over force-stage). |
| `--apply-staged <file>` | Promote a previously-staged rewrite (the LIVE rel path, e.g. `src/components/Card.tsx`) from the staged mirror to live source, after the user reviewed it. Backed by the engine (`extract … --apply-staged <file>`): backup live (+ its collateral test) → write live → merge the staged catalog into the live catalog → ledger → drop the staged entry. Reversible by batch. |
| `--phase <name>` | Run a single phase only (`extract` / `wire` / `translate` / `wire-to-locale` / `guard`). Default runs the whole loop. |

## The confidence routing (KTD-2)

A file's routing confidence is the **most-cautious** of its included sites — one low-confidence site (a long interpolated toast, a date needing the timeZone decision) pulls the whole file to a review path. The codemod still rewrites the high-confidence siblings inside that file; the file is just staged/inline rather than silently auto-written.

| File confidence | Route | What happens |
|---|---|---|
| **high** (every site high) | **auto-write** | Backup FIRST → codemod rewrites the live source → namespaced catalog merged (atomic). Recorded in the extract ledger for resumability. |
| **medium** | **stage** | The rewrite + catalog are written to `.vibe-lingual/localize/staged/<file>` for review, and a `staged-manifest.json` entry records the read-back contract (live target, namespace, catalog paths, collateral tests). Live source UNTOUCHED. Promote with `--apply-staged <live-rel-path>` once reviewed. |
| **low** | **inline-only** | A suggestion surfaced in the banner. No write at all. |
| **blocked** (audit readiness) | **inline-only** | A firebase-admin SSR file or an unhandled dynamic-route glob NEVER auto-writes, regardless of confidence. The block reason is surfaced. |

## Backup + rollback (load-bearing order)

Every auto-write batch creates a timestamped backup batch at `.vibe-lingual/localize/backup/<batchId>/` mirroring the source tree, with a `manifest.json` mapping each backup to its source. **The order is always: backup → write source → merge catalog → ledger entry.** A mutation that skipped the backup is the one bug the backup module exists to make impossible. `--rollback <timestamp>` restores every file in a batch to its exact original bytes (CRLF, trailing newlines, the original quote style — all verbatim). The codemod's recast pass normalizes formatting; rollback undoes that too.

## Workflow

### 1. Read state + resolve the adapter

Invoke `session-logger` (sentinel start). Read + validate `inventory.json` against `inventory.schema.json` and `audit.json` against `audit.schema.json`. If either is missing/invalid, instruct the user to (re-)run the upstream command and exit. Read `config.json` if present; if absent, hand off to `first-run-setup` to capture the framework + adapter + decisions, then continue.

Resolve the adapter via the registry (`engine/adapters/index.mjs` → `resolveAdapter(detection)`). If `status !== 'ready'` (no implemented adapter), STOP: surface the `not-yet-implemented` report naming the detected framework, friction-log `adapter-not-implemented`, and exit WITHOUT mutating anything. v1 only mutates next-intl App Router apps.

### 2. Gate on the REQUIRED decisions

Before any date-surface work, the audit's REQUIRED `timezone` decision must be answered (in `config.json.decisions.timezone` or via an interview gate here). If unanswered AND the inventory has presentational date sites, use AskUserQuestion to surface the choice with the audit's recommendation (`mixed` — browser zone for client-local dates, explicit zone for SSR dates). Do NOT auto-pick — a wrong global tz shifts dates by a day for distant viewers. Surface `dual-locale` (separate vs lockstep) the same way when the app already declares a content/output locale. Record the answers to `config.json`.

### 3. Dry-run preview (default first move on a real app)

Run the engine in dry-run to route every file without writing:
```bash
node engine/cli.mjs extract <appRoot> \
  --inventory <appRoot>/.vibe-lingual/state/inventory.json \
  --audit <appRoot>/.vibe-lingual/state/audit.json \
  --dry-run
```
Present the routing plan: how many files auto-write / stage / inline / blocked, and the key count. Get the user's go before the real run (unless they passed an explicit non-preview flag).

### 4. Extract (the codemod, confidence-routed)

Run the same command without `--dry-run`. The engine, per file in descending-density order:
- skips files already written (the ledger — resumability) or that the codemod reports unchanged (idempotency);
- routes by confidence: **auto-write** (backup → rewrite → merge catalog → ledger), **stage**, or **inline-only**;
- honors audit readiness — **blocked files are never auto-written**.

Catalogs are MERGED, never clobbered: existing keys survive (a human-edited translation is never stomped), new keys are added, and the write is atomic (temp + rename) so a crash never leaves a half-catalog. Capture the run-report JSON (it carries the backup batch id — note it for rollback).

### 5. Wire the framework

Emit the next-intl wiring set (modeled byte-for-byte on the cowpath):
```bash
node engine/cli.mjs wire <appRoot> [--locales <reused-list>] [--source-locale en]
```
The `WiredFileSet` carries: `request.ts` (AVAILABLE-list guard + try/catch source-locale fallback — a selected-but-missing catalog never crashes the request), `locale-cookie.ts` (the single cookie-name source), the layout `<NextIntlClientProvider>` mount patch, the `next.config` `createNextIntlPlugin` patch, and **the jest `transformIgnorePatterns` ESM allowlist patch** (next-intl 4.x is ESM-only — the existing suite breaks on first run without it). Reuse a detected language list (e.g. `SUPPORTED_LANGUAGES`) for the UI locale set; model UI locale SEPARATELY from any content/output locale. Apply the new files + patches with the same backup discipline as extract.

### 6. Translate (draft the catalogs)

For each target locale beyond the source: draft the catalog by translating the source-locale keys. **Use the app's own configured LLM where one is available** (detected during scan/setup — the app already has an LLM client and a key) — never ship a vibe-lingual API key, never call an external service of our own. When no app LLM is available, **mark the keys** untranslated (write the source string with a `// TODO: translate` companion or a `_meta.untranslated` marker the parity test tolerates) and tell the user which locales need a human/automated pass. The source catalog (`en`) is always generated first so the AVAILABLE-list fallback always has a target (the anonymous-SSR-viewer case).

### 7. Wire-to-locale + html-lang

Mirror the UI locale → cookie + `router.refresh()`, guarded by a cookie-difference check (avoid refresh loops). Document the one-render cookie lag on fresh login (it is NOT a bug — the cookie is set client-side, so the first paint may render one frame in the source locale). If the `html-lang` decision is `yes`, update the root layout `<html lang="en">` → `lang={locale}` (async layout + `getLocale()`).

### 8. Guard (the ratchet + parity)

Emit the two guards:
- **Parity test** — `node engine/cli.mjs parity <appRoot> --messages <dir>` verifies recursive key-path parity across catalogs (catches BOTH missing AND extra keys). Write the `emitParityTest` output into the app's test suite. This is the single highest-value reusable guard.
- **jsx-no-literals ratchet** — flip `react/jsx-no-literals` to `error` per **FULLY-extracted file** (it is noisy on partially-extracted files). The guard emitter globs dynamic-route segments with `*` (never the literal `[param]`, which silently never matches) and self-verifies via `eslint --print-config`.

### 9. Test-harness collateral (engine-driven)

Adding next-intl hooks to a component breaks its EXISTING tests — they now need a `NextIntlClientProvider` wrapper. This is **handled by the extract engine, not by hand** (the cowpath called it mechanical/automatable): for every auto-written component the engine discovers a co-located test (`<Base>.test.tsx` / `.spec.tsx`, sibling or under `__tests__/`), **backs it up INTO the same batch** (so `--rollback` returns the repo to a coherent pre-localize state — component AND test both restored), and provider-wraps it (`<NextIntlClientProvider locale="en" messages={{}} timeZone="UTC">` around each `render(...)`). The same happens on `--apply-staged` promotion.

Read the run-report's `collateralTests[]` (per result) and `summary.collateralTests` / `collateralTestsWrapped` / `collateralTestsNeedManualWrap`. If `collateralTestsNeedManualWrap > 0`, the engine couldn't auto-wrap a test cleanly (no `render(<JSX>)` call found, or already wrapped) — those entries carry a `reason`; surface them so the user wraps them by hand. The test is still backed up either way, so rollback stays coherent. Fill real `messages` for the namespace when you know it (the engine leaves `messages={{}}`, which next-intl tolerates by echoing the key).

### 10. Confirm + banner

After the loop, run the app's test suite if present — a passing suite is the truth, not the structural-green of our own engine. Render the banner (≤ 20 lines): files written/staged/inline/blocked, keys written, the backup batch id (for rollback), and the next move. Post-flight: `session-logger` terminal entry.

## Banner template

```
═══ Vibe-Lingual localize ═══
App:        <appRoot>   Adapter: next-intl (App Router)

Extract:    <w> written · <s> staged · <i> inline-only · <b> blocked · <k> keys
Tests:      <ct> co-located test(s) — <cw> provider-wrapped, <cm> need a manual wrap
Wired:      request.ts · locale-cookie.ts · provider · next.config · jest ESM patch
Catalogs:   messages/en/*.json (source) · <N> locale(s) drafted, <M> marked untranslated
Guard:      parity test emitted · jsx-no-literals ratcheted on <g> file(s)

Backup batch: <batchId>   (rollback: /vibe-lingual:localize --rollback <batchId>)
Staged:       <staged-count> file(s) in .vibe-lingual/localize/staged/ — review then
              --apply-staged <live-rel-path> (e.g. src/components/Card.tsx)

Next: review staged files, run your test suite, then translate the marked locales.
```

## Friction triggers

See the family `friction-triggers` convention. Highlights:
- `adapter-not-implemented` — the detected framework has no implemented adapter; localize refused to mutate. Confidence: high.
- `required-decision-unanswered` — the timeZone decision was not answered and date sites exist; the date surface was held. Confidence: high.
- `auto-write-rolled-back` — the user rolled back an auto-applied batch. Confidence: high → raise the auto-write bar or move a category to always-stage.
- `staged-rewrite-rejected` — the user rejected a staged rewrite instead of promoting it. Confidence: medium → tune confidence routing.
- `app-test-suite-red-after-extract` — the app's own tests went red after extraction (likely a missing provider wrapper). P0. Confidence: high.
- `catalog-merge-conflict` — a catalog could not be merged cleanly. Confidence: high.

## Never

- Mutate source without writing the backup FIRST. Order is backup → write → merge catalog → ledger, always.
- Auto-write a file below the high-confidence bar without the user's go (medium stages, low is inline-only). `--stage-all` forces every file to stage — the conservative default for a first pass.
- Edit a co-located test as collateral of a write WITHOUT putting it through the same backup batch first. A test edit outside the batch breaks the "rollback restores exactly" guarantee (the component reverts, the test stays wrapped). The engine backs the test up before wrapping; never hand-edit a test the engine left unwrapped without backing it up into the run's batch yourself.
- Auto-write a blocked file (firebase-admin SSR / unhandled dynamic-route glob). Audit readiness is the gate.
- Auto-resolve the REQUIRED timeZone decision. Surface it; let the user pick.
- Clobber a catalog. Merge — existing keys win; a human-edited translation is never stomped.
- Ship a vibe-lingual API key or call our own external service to translate. Use the APP's configured LLM, or mark the keys for a later pass.
- Extract a structural `Intl` site (tz-offset math / locale-invariant parsing). The scanner excluded it; the codemod leaves it alone. Extracting it corrupts logic (KTD-5).
- Mutate when no implemented adapter claims the app. Report `not-yet-implemented` and stop (KTD-3).
