---
name: scan
description: This skill should be used when the user says "/vibe-lingual:scan", "scan my UI strings", "inventory my translatable strings", "find what needs localizing", or wants a six-block i18n readiness brief. Reads target source, inventories every user-facing string by kind (jsx-text, placeholder, aria-label, title, alt, toast, date-intl), detects existing i18n, and writes .vibe-lingual/state/inventory.json + a dated scan report. Read-only — no source mutation.
---

# /vibe-lingual:scan — string inventory + six-block brief

Load `vibe-lingual:guide` first for the i18n-retrofit persona and posture.

Inventory every user-facing string in the target app and emit the six-block readiness brief. This is the entry point of the scan → audit → localize arc — the first move in any app, and the read-only foundation the other two steps build on. The deterministic engine does the AST-heavy work; this SKILL orchestrates it, confirms the output, and surfaces the brief to the user.

## Prerequisite

None. `scan` is the first command — it has no upstream state to read. It produces the `inventory.json` that `audit` and `localize` require.

## Inputs

- **Target app:** the current working directory, or a path argument if the user named one. Resolve to an absolute path before invoking the engine.
- No flags. Always a full scan.

## What it touches (read-only contract)

- **Reads:** the target app's component/source tree (`.tsx`/`.jsx`/`.ts`/`.js`), parsed with `@babel/parser`. Never executes app code, never hits the network.
- **Writes (inside the target app, never source):**
  - `.vibe-lingual/state/inventory.json` — the machine-readable inventory.
  - `docs/vibe-lingual/scan-YYYY-MM-DD.md` — the human-readable six-block brief.
- **Never mutates target source.** Not one component file changes. This is the inviolable contract for scan — extraction is `localize`'s job, gated behind confidence routing and per-file backups. If a run would touch a source file, that is a bug — abort and friction-log it.

## Workflow

1. **Pre-flight.** Invoke `session-logger` (sentinel start entry). Resolve the target app root (cwd or the path argument). Confirm it's a recognized stack — a `package.json` at the root. If none, friction-log `no-recognized-stack` and exit with a clean message ("No package.json found at `<root>` — point me at a Next.js / React app root").

2. **Compute the dated paths.** Today's date in `YYYY-MM-DD` (UTC, to keep filenames stable across time zones). Inventory path: `.vibe-lingual/state/inventory.json`. Brief path: `docs/vibe-lingual/scan-<date>.md`. Both are relative to the target app root.

3. **Run the engine.** From the plugin's `engine/` directory, invoke the CLI against the resolved app root:
   ```bash
   node engine/cli.mjs scan <appRoot> \
     --inventory <appRoot>/.vibe-lingual/state/inventory.json \
     --brief <appRoot>/docs/vibe-lingual/scan-<date>.md
   ```
   The CLI runs `detect` → `scan` → `brief` internally and writes both files atomically (it `mkdir -p`s the parent dirs). It prints a one-line summary to stderr: total sites, structural-excluded count, the **files-with-localizable-work count** (files holding ≥1 included site — files whose only sites are excluded structural-`Intl` are NOT counted, so this matches brief Block 2 exactly), and the two output paths. Capture that line.

4. **Confirm the inventory validates.** Read back `.vibe-lingual/state/inventory.json` and sanity-check it against `plugins/vibe-lingual/schemas/inventory.schema.json`:
   - Required top-level keys present: `schemaVersion` (must be `1`), `app`, `existingI18n`, `sites`, `countsByKind`, `componentsByDensity`.
   - `app.framework` is one of the schema's enum values; `app.routerType` ∈ {`app`,`pages`,`unknown`}.
   - `countsByKind` carries all seven kinds.
   - No `_meta` key survived into the persisted JSON (it's non-enumerable by design — if it's there, the engine's serialization broke; friction-log `inventory-schema-violation` and abort before surfacing anything).
   - If validation fails, do NOT surface a brief — the inventory is the source of truth. Report the violation and stop.

5. **Confirm no source was mutated.** The engine is read-only by construction, but verify the contract held: only `.vibe-lingual/state/inventory.json` and the dated brief under `docs/vibe-lingual/` should be new/changed. If the target is a git repo, a quick `git status --short` should show nothing outside those two paths. If anything else changed, that's a P0 — friction-log `scan-mutated-source` and surface it loudly.

6. **Surface the six-block brief.** Read the dated brief and present it to the user. It carries all six blocks, every number grounded in the inventory:
   - **Block 1 — Framework & i18n detection:** router type, i18n framework (or `none`), Turbopack, SSR surfaces. Recommends next-intl-without-routing when the app is App-Router + no-lib.
   - **Block 2 — Surface inventory:** files-with-localizable-work count (same number as the stderr summary and banner — files holding ≥1 included site; structural-`Intl`-only files are excluded and noted parenthetically), total included sites, top components by string density (where the work concentrates).
   - **Block 3 — String-source audit:** counts by kind, with structural `Intl` sites called out as EXCLUDED (tz-offset math / locale-invariant parsing — extracting them corrupts logic). Notes that the scanner owns attribute-literal detection, not ESLint.
   - **Block 4 — Existing-localization map:** detected i18n lib, existing language list (reuse it — don't generate a parallel one), locale preference, and the dual-locale check (UI locale vs content/output locale do not move in lockstep).
   - **Block 5 — Gap + phased plan:** the extract → wire → translate → wire-to-locale → guard arc, sized to this app's counts.
   - **Block 6 — Stack-specific gotchas:** firebase-admin-in-SSR, the timeZone decision (surfaced, not auto-resolved), RTL surface, jest/ESM transform patch, dynamic-route ESLint glob, anonymous-SSR-viewer fallback, `<html lang>`.

7. **Render the banner.** ≤ 20 lines. Lead with the headline numbers, end with the next move.

8. **Post-flight.** `session-logger` terminal entry.

## Banner template

```
═══ Vibe-Lingual scan ═══
App:        <appRoot>
Framework:  next-intl (App Router, Turbopack: no)
Existing:   SUPPORTED_LANGUAGES (src/lib/languages.ts) · outputLanguage (src/types/preferences.ts)

Sites:      922 total (22 structural Intl excluded)
By kind:    jsx-text 725 · placeholder 25 · aria-label 57 · title 20 · alt 14 · toast 38 · date-intl 43
Files:      66 with localizable strings (matches brief Block 2)
Top file:   src/components/DashboardShell.tsx (NN sites)

Inventory:  .vibe-lingual/state/inventory.json
Brief:      docs/vibe-lingual/scan-2026-06-21.md (six blocks)

Next: /vibe-lingual:audit — surface the retrofit gotchas + per-file readiness.
```

## Next step

Recommend `/vibe-lingual:audit`. It reads the cached `inventory.json` (no re-scan) and surfaces the gotcha rules (firebase-admin-SSR, structural-Intl confirmation gate, the timeZone decision, RTL absence, dynamic-route globs) plus per-file readiness and the phased plan. Audit is still read-only — `localize` is the only mutating step, and it sits behind both scan and audit.

## Friction triggers

See the family `friction-triggers` convention. Highlights:
- `no-recognized-stack` — no `package.json` at the resolved root. Confidence: high.
- `inventory-schema-violation` — the engine emitted JSON that doesn't validate (e.g. `_meta` leaked, a kind missing). Confidence: high.
- `scan-mutated-source` — a source file changed during a read-only scan. P0. Confidence: high.
- `structural-intl-density-high` — an unusually high share of date-intl sites flagged structural (the classifier may be over-excluding; worth a human spot-check). Confidence: medium.

## Never

- Mutate any target source file. Extraction belongs to `localize`, behind confidence routing + backups.
- Run app code or hit the network. The scan is pure AST + filesystem read.
- Auto-include a structural `Intl` site. Structural-vs-presentational is a scan-time classification and an audit-time confirmation gate — never a silent extraction (KTD-5).
- Re-write `inventory.json` from a partial scan. The CLI writes atomically (the only writer); don't hand-patch the JSON.
- Delegate attribute-literal detection (placeholder / aria-label / title / alt) to ESLint. The scanner owns it; ESLint `jsx-no-literals` is reserved for JSX text only (KTD-4).
