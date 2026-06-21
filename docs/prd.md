# PRD — vibe-lingual (Cart cycle #17)

> Expands `scope.md` into epics, user stories, and testable acceptance criteria. Zero deepening rounds (returning builder, vision formed via the cowpath seed); the prompt-machine pass ran and its findings are folded into the edge cases + acceptance criteria below. Input to /spec.

**Priority legend:** **[MUST]** = v1 ship gate · **[LATER]** = v2 seam, declared not implemented.

---

## Epic 1 — Scan & detect (`/vibe-lingual:scan`)
Read-only. Produces `.vibe-lingual/state/inventory.json` + the six-block brief.

**Story 1.1 — Framework & i18n detection.** As a user, I point the plugin at my repo and it tells me my framework, router type, SSR boundaries, and whether i18n already exists.
- **[MUST]** AC1: Detects Next.js App Router vs Pages Router; reports Turbopack presence.
- **[MUST]** AC2: Detects whether an i18n lib is installed (next-intl, react-i18next, react-intl, lingui, i18next) and reports which.
- **[MUST]** AC3: Detects an existing app language list / locale preference to reuse (e.g. a `SUPPORTED_LANGUAGES` array + an `outputLanguage`-style pref) and names the file:symbol.
- **[MUST]** AC4: Identifies SSR boundaries (server components / SSR routes) vs client components.

**Story 1.2 — String-source inventory by kind.** As a user, I get accurate counts of what needs localizing, by kind.
- **[MUST]** AC1: Counts JSX text nodes, `placeholder`, `aria-label`/`title`/`alt`, toast/error literals, and locale-sensitive date/number calls (`toLocaleDateString`, `toLocaleString`, `Intl.*`) — separately.
- **[MUST]** AC2: Flags locale-sensitive `Intl` sites as **candidate** but marks ones that look **structural** (tz-offset math, locale-invariant parsing) for human confirmation rather than auto-including them.
- **[MUST]** AC3: Ranks components by string density (heaviest-first) as extraction candidates.
- **[MUST]** AC4: Writes `inventory.json` with per-site records (file, line, kind, text/snippet, suggested namespace+key).

**Story 1.3 — Six-block brief.** As a user, I get a readable brief for any repo.
- **[MUST]** AC1: Emits the six blocks verbatim in structure: framework & i18n detection / surface inventory / string-source audit / existing-localization map / gap + phased plan / stack-specific gotchas.
- **[MUST]** AC2: Brief is written to a dated markdown file under `docs/vibe-lingual/`.

## Epic 2 — Audit (`/vibe-lingual:audit`)
Read-only analysis over `inventory.json`. Writes `audit.json` + dated markdown.

**Story 2.1 — Gotcha detection.** As a user, the audit warns me about the traps before I localize.
- **[MUST]** AC1: Flags `firebase-admin` imports in any App Router `page.tsx`/`layout.tsx` (SSR-ban gotcha).
- **[MUST]** AC2: Flags structural `Intl` usage to EXCLUDE from extraction, with file:line and reason.
- **[MUST]** AC3: Surfaces the **timeZone decision** as a required choice (client-local per-call vs SSR fixed) rather than auto-resolving.
- **[MUST]** AC4: Reports RTL readiness (LTR-only layout? any `dir=` handling?) and flags it before any RTL locale is added.
- **[MUST]** AC5: Flags the dynamic-route ESLint-glob trap when a guarded file lives under a `[param]` segment.

**Story 2.2 — Per-file readiness + plan.** As a user, I get a prioritized, phased extraction plan.
- **[MUST]** AC1: Marks each candidate file as ready / blocked (and why).
- **[MUST]** AC2: Emits the gap + phased plan (extract → wire → translate → wire-to-locale → guard) ordered by density and risk.

## Epic 3 — Localize (`/vibe-lingual:localize`)
The mutating loop. Idempotent, resumable, backup + rollback.

**Story 3.1 — Framework wiring (next-intl, no-routing).** As a user, the plugin wires next-intl correctly the first time.
- **[MUST]** AC1: Installs next-intl; wires the plugin in `next.config.*` with an explicit request-config path; mounts `NextIntlClientProvider`.
- **[MUST]** AC2: Sets up cookie-driven locale (`NEXT_LOCALE`-style) mirrored from a UI-locale pref, with an `AVAILABLE`-list guard + try/catch fallback to the source locale (missing catalog never crashes).
- **[MUST]** AC3: Patches the jest transform config (`transformIgnorePatterns` allowlist) for the i18n lib's ESM, so the existing test suite survives.
- **[MUST]** AC4: When an existing language list/pref is detected (Story 1.1 AC3), reuses it and models UI locale **separately** from any output/content locale.

**Story 3.2 — Extraction.** As a user, my hardcoded strings move to catalogs without breaking the UI.
- **[MUST]** AC1: Extracts a file's user-facing strings (text + attribute kinds) to namespaced catalog keys; replaces with `t()` / server `getTranslations` / `useFormatter` as appropriate to the component's server/client nature.
- **[MUST]** AC2: Confidence routing: high → auto-write with backup; medium → stage for review; low → inline-only suggestion. Never silently mutates a low-confidence site.
- **[MUST]** AC3: Updates a component's EXISTING tests to wrap in the i18n provider when hooks are introduced (test-harness collateral).
- **[MUST]** AC4: Per-file backup + a working rollback (by timestamp or file).

**Story 3.3 — Translate + parity guard.** As a user, target-locale catalogs are drafted and kept honest.
- **[MUST]** AC1: Drafts target-locale catalogs (via the app's own LLM where available; otherwise marks keys for translation) — source locale first.
- **[MUST]** AC2: Emits a recursive key-path parity test asserting every catalog has an identical key set (catches missing AND extra keys).
- **[MUST]** AC3: Planet/sign/proper-noun-style "keep recognizable" terms are preserved per any detected existing directive rule.

**Story 3.4 — Guard ratchet.** As a user, localized files can't silently regress.
- **[MUST]** AC1: Flips `react/jsx-no-literals` to `error` per **fully-extracted** file only (never project-wide upfront).
- **[MUST]** AC2: Globs dynamic-route files with `*` (e.g. `src/app/s/*/page.tsx`), NOT the literal `[param]`, and verifies each guarded file resolves the rule (`eslint --print-config`).
- **[MUST]** AC3: Attribute-literal detection (placeholder/aria-label/title/alt) is owned by the plugin's own scanner, NOT delegated to ESLint.

**Story 3.5 — Idempotent / resumable.** As a user, I run `:localize` repeatedly until done.
- **[MUST]** AC1: Re-running picks up where it left off (already-extracted files are skipped/converged); safe to run across many sessions (Phase 2 mode).

## Epic 4 — Adapter seam
**Story 4.1 — Detect-and-dispatch.** As a user with any web app, I get correct handling or an honest "not yet."
- **[MUST]** AC1: A framework-adapter interface; the **next-intl / App Router** adapter is fully implemented.
- **[MUST]** AC2: A non-next-intl / non-App-Router app is detected and returns a clean "adapter not yet implemented: <framework>" verdict — never a wrong-handling mutation or crash.
- **[LATER]** AC3: react-i18next, Pages Router, vue-i18n adapters (declared seams, documented).

## Epic 5 — Plugin scaffold, router, evolve hooks
**Story 5.1 — Plugin structure.** Matches marketplace siblings.
- **[MUST]** AC1: `.claude-plugin/plugin.json` present at the loader-recognized location with name/version/metadata.
- **[MUST]** AC2: SKILL files for router + scan + audit + localize, with trigger phrases.
- **[MUST]** AC3: A guide/persona SKILL (family convention).

**Story 5.2 — State-aware router (`/vibe-lingual`).**
- **[MUST]** AC1: Reads cached state, recommends the next move (scan → audit → localize); never auto-fires a mutating step.
- **[MUST]** AC2: First run (no `.vibe-lingual/`) gracefully points to `:scan`.

**Story 5.3 — Self-evolving hooks (placeholders).**
- **[MUST]** AC1: `session-logger`, `friction-logger`, `evolve-lingual` ship as documentation-only with reserved data paths (no implementation, no disk restructure needed for v2).

---

## Cross-cutting NFRs
- **[MUST]** Markdown/SKILL-driven, zero runtime beyond what the target app already has; scan/audit are pure-read.
- **[MUST]** Real-app validation: every command proven against Celestia3 before ship (family bar).
- **[MUST]** No secrets, no network calls except the app's own configured LLM for translation drafting.

## Consolidated edge cases (prompt-machine pass)
1. App already has next-intl partially wired → detect and extend, don't double-wire.
2. Mixed server/client components in one extraction batch → pick `getTranslations` vs `useTranslations` per file correctly.
3. Anonymous SSR viewer (share route) with no locale cookie → fall back to source locale (AVAILABLE guard).
4. A "string" that's actually a CSS class / data attribute / test id → must NOT be extracted (false-positive guard).
5. Catalog already exists for some locales but not others → parity test reconciles; `:localize` fills gaps, doesn't clobber.
6. Component test that already wraps a provider → don't double-wrap.
7. Monorepo / multiple apps → scan scopes to one app root (declare; multi-root is LATER).
8. `:localize` interrupted mid-file → backup makes re-run safe; no half-written catalogs committed.

## Out of scope (v1)
Per `scope.md`: non-next-intl adapters, Pages Router, RTL layout transformation, auto-translation quality guarantees, auto-deciding soft policies (dual-locale / SSR timeZone / `<html lang>`), non-web targets.

## Next
`/spec` — turn these epics into the technical blueprint (plugin file layout, SKILL contracts, state schemas, the adapter interface).
