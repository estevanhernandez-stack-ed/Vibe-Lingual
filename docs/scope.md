# Scope — vibe-lingual (Cart cycle #17)

> Compressed scope. The cowpath seed (`docs/inputs/cowpath-seed.md`) settled the framework, phase sequence, and gotchas; the two load-bearing forks (command surface, v1 breadth) were confirmed via decision matrix at /scope. Input to /prd.

## One-liner
A Claude Code plugin that takes an app from hardcoded UI strings to localized UI — by doing the work a developer would: detect the framework and any existing i18n, inventory the string surface, extract to message catalogs, wire the framework + locale, translate, and lock it with guards.

## The user
A vibe coder / solo developer with a shipped (or shipping) app whose UI strings are hardcoded English, who wants real i18n without grinding ~600-800 strings by hand. Same audience as the rest of the vibe-* family. They run Claude Code; they want autonomous read-then-do with gates on the soft per-app decisions.

## The problem
UI i18n is high-toil and full of quiet traps the cowpath surfaced: missed string kinds (placeholder / aria-label / title / alt / toast literals, not just JSX text), structural-vs-presentational `Intl` confusion (extracting tz-offset math corrupts logic), framework-wiring gotchas (ESM jest transform, SSR boundaries, cookie-driven locale, timeZone fallback), catalog drift (missing/extra keys), and ESLint-glob foot-guns on dynamic routes. Done by hand it's the exact ~600-800-string grind Phase 0 proved on Celestia3. The plugin does the volume and dodges the traps.

## v1 scope — what we're building

**Command surface (confirmed): router + scan + audit + localize.**
- **`/vibe-lingual`** — bare, state-aware router. Reads cached state, recommends the next move (scan → audit → localize). Never auto-fires.
- **`/vibe-lingual:scan`** — read-only inventory. Detects framework + router type + SSR boundaries, maps existing i18n (lib present? existing language list/pref to reuse?), and inventories the string surface by kind. Writes `.vibe-lingual/state/inventory.json`. Emits the **six-block scan brief** (the seed's §7 template): framework & i18n detection, surface inventory, string-source audit (counts by kind), existing-localization map, gap + phased plan, stack-specific gotchas.
- **`/vibe-lingual:audit`** — read-only analysis over the inventory: extraction gaps, the stack gotchas (structural Intl exclusions, firebase-admin-in-SSR, RTL flag, timeZone policy, dynamic-route glob), and per-file readiness. Writes `.vibe-lingual/state/audit.json` + a dated `docs/vibe-lingual/audit-YYYY-MM-DD.md`.
- **`/vibe-lingual:localize`** — the mutating loop: **extract → wire framework → translate → wire-to-locale → guard**, with vibe-prompt-style confidence routing (≥high auto-write with backup; medium stage for review; low inline-only), backup + rollback, and per-file review. This is where the volume gets done; it's idempotent and resumable (run repeatedly until the surface is localized — Phase 2's mode).

**Framework breadth (confirmed): adapter seam, next-intl deep.**
- A framework-adapter architecture (detect → dispatch to an adapter) so the plugin generalizes, with **only the next-intl / Next.js App Router adapter implemented in v1** — the cowpath-proven path, dogfoodable on Celestia3 immediately.
- Other adapters (react-i18next, Next.js Pages Router, vue-i18n, etc.) are declared seams: detected, named, and documented as "not yet implemented" rather than silently mis-handled. v2 lights them up without a restructure.

**Self-evolving plugin hooks (family convention):** `session-logger`, `friction-logger`, and `evolve-lingual` ship as documentation-only placeholders with reserved data paths (same pattern as vibe-taker/vibe-walk), so v2 lights them up without a disk restructure.

## Explicit cuts (NOT in v1)
- **Non-next-intl adapters** — seam present, only next-intl implemented.
- **Pages Router** — App Router only in v1 (Celestia3 is App Router); Pages Router is a declared v2 adapter seam.
- **RTL layout transformation** — detect and *flag* before adding Arabic/Hebrew/Urdu; do NOT auto-transform layout direction.
- **Auto-translation quality guarantees** — `:localize` drafts catalogs (via the app's own LLM where available, the meta-dogfood path) and locks them with a parity guard; human review of translations is expected, not eliminated.
- **Auto-deciding the soft per-app policies** — dual-locale model (separate UI vs output locale), SSR timeZone policy, and `<html lang>` strategy are surfaced as prompts/recommendations, not silently auto-resolved.
- **Non-web targets** (mobile/desktop string tables) — out of scope; web app-router i18n only.

## Constraints
- Markdown/SKILL-driven Claude Code plugin; matches the 13 marketplace siblings' conventions (`.claude-plugin/plugin.json` as the only loader-recognized manifest location — per the family's manifest-location contract).
- Autonomous-first read (scan/audit) + interview gates on soft decisions only.
- Solo repo `C:\Users\estev\Projects\Vibe-Lingual`, local-first (no remote until ship; confirm before any public surface — harness per-command gate).
- Deployment target `vibe-plugins-marketplace`: canary on solo repo, stable via `marketplace.json` ref-bump; plain `vX.Y.Z` tags.
- Tenant: 626Labs/personal (NOT Marcus).

## v1 ship gates (success criteria)
1. `:scan` produces the full six-block brief + `inventory.json` on a real app (Celestia3) with accurate by-kind counts and correct existing-i18n detection (finds `SUPPORTED_LANGUAGES`/`outputLanguage`).
2. `:audit` correctly flags the structural-Intl exclusion (`birthDateTime.ts`), the timeZone policy decision, RTL absence, and the dynamic-route glob trap.
3. `:localize` end-to-end on at least one un-extracted Celestia3 surface: extracts the strings, wires/extends next-intl, drafts the catalogs, emits the recursive parity guard, ratchets `react/jsx-no-literals` on the now-clean file — with backup + working rollback, leaving tests green.
4. The adapter seam is real: a non-next-intl app is detected and gets a clean "adapter not yet implemented" verdict, not a wrong-handling crash.
5. Dogfood-ready: running `:localize` repeatedly converges (idempotent/resumable) — the Phase 2 mode.

## Next
`/prd` — turn this into epics + testable acceptance criteria. Expect compression; the seed and these gates already carry most of it.
