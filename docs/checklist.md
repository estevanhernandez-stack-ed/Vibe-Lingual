# Build Checklist — vibe-lingual (Cart cycle #17)

> Dependency-ordered milestones from `spec.md`. Lessons baked in: **dogfood early** (bbb — real-app run right after the engine lands, not just at the end), **wire-as-you-build** (ccc — each SKILL integrates with its engine piece as it lands), **structural-green ≠ works** (aaa — a passing test suite is not a working plugin; the dogfood is the truth). Effort is rough (S/M/L). Final item is always Documentation & Security Verification.

Repo: `C:\Users\estev\Projects\Vibe-Lingual`, marketplace path `plugins/vibe-lingual/`. Engine: Node ESM + jscodeshift, tests in jest.

---

### M0 — Scaffold + plugin loads · effort M · deps: none
Build the plugin skeleton so Claude Code loads it and `jest` runs.
- `plugins/vibe-lingual/.claude-plugin/plugin.json` (name, version 0.1.0, description, author).
- `commands/{vibe-lingual,scan,audit,localize}.md` mapping each slash command to its skill.
- `skills/{router,guide,scan,audit,localize}/SKILL.md` headers (frontmatter + trigger phrases; bodies stubbed).
- `package.json` (type:module, jest + jscodeshift + @babel/parser devDeps), `.gitignore`, README skeleton, `engine/cli.mjs` dispatch stub.
- **AC:** plugin-validator PASS on the manifest; `npm test` runs (zero tests OK); commands resolve to skills.

### M1 — Engine: detection · effort M · deps: M0
- `engine/detect.mjs`: framework (next-intl/react-i18next/lingui/none), router type (app/pages), Turbopack, SSR files, existing-i18n map (language-list symbol + locale-pref symbol).
- `tests/detect.test.mjs` + `tests/fixtures/` (tiny app trees: app-router+next-intl-absent, app-router+next-intl-present, pages-router).
- **AC:** correctly classifies all fixtures; finds a `SUPPORTED_LANGUAGES`-shaped list + an `outputLanguage`-shaped pref when present.

### M2 — Engine: scan + six-block brief · effort L · deps: M1
- `engine/scan.mjs`: AST + attribute walk → string sites by kind (jsx-text, placeholder, aria-label, title, alt, toast, date-intl); structural-Intl classification flag; density ranking; suggested namespace/key + confidence.
- `engine/brief.mjs`: assemble the six-block markdown brief. `schemas/inventory.schema.json`.
- `tests/scan.test.mjs` (+ fixtures incl. a structural-Intl case that must NOT be auto-included, and a CSS-class/test-id false-positive that must NOT be extracted).
- **AC:** counts-by-kind correct on fixtures; structural-Intl flagged not included; `inventory.json` validates; brief emits all six blocks.
- **DOGFOOD-EARLY (bbb):** run `node engine/cli.mjs scan` against `C:\Users\estev\Projects\Celestia3` — counts are in the cowpath's ballpark (~600-800 strings, ~65 components), existing-i18n found, and the **4 already-localized cowpath surfaces are NOT re-flagged** (regression oracle). Fix detection/scan before proceeding if it lies.

### M3 — `scan` SKILL wired (ccc) · effort S · deps: M2
- Flesh `skills/scan/SKILL.md`: orchestrate `engine scan` → write `.vibe-lingual/state/inventory.json` + `docs/vibe-lingual/scan-YYYY-MM-DD.md`; read-only.
- **AC:** `/vibe-lingual:scan` produces state + dated brief on the Celestia3 dogfood; no source mutation.

### M4 — Engine + SKILL: audit · effort M · deps: M2
- `engine/audit.mjs`: gotcha rules (firebase-admin-ssr, structural-intl, timezone-decision, rtl, dynamic-route-glob) + per-file readiness + phased plan. `schemas/audit.schema.json`. Flesh `skills/audit/SKILL.md`.
- `tests/audit.test.mjs`.
- **AC:** on the Celestia3 inventory, flags `birthDateTime.ts` structural-Intl, surfaces the timeZone decision, reports RTL absence, and flags the `[shareId]` dynamic-route glob; `audit.json` validates; dated markdown emitted.

### M5 — Adapter seam · effort S · deps: M1
- `engine/adapters/index.mjs` registry (detect→dispatch) + `adapter.contract.md` (the FrameworkAdapter interface) + `_stubs/` for react-i18next/pages-router/vue-i18n.
- `tests/adapters.test.mjs`.
- **AC:** registry returns the next-intl adapter for a matching app; a non-match returns `{adapter:null, status:"not-yet-implemented", framework}` — no crash, no mutation.

### M6 — next-intl adapter: wiring · effort L · deps: M5
- `adapters/next-intl/wire.mjs` + `templates/` (request.ts w/ AVAILABLE+try/catch fallback, locale-cookie.ts, provider mount snippet, jest transformIgnorePatterns patch, next.config plugin wiring). Modeled byte-for-byte on the cowpath-proven shapes.
- `tests/wire.test.mjs`.
- **AC:** emits the full wiring set; jest-patch injects the ESM allowlist; request.ts has the AVAILABLE-list + en-fallback; reuses a detected existing language list.

### M7 — next-intl adapter: transform + guard + parity · effort L · deps: M6
- `adapters/next-intl/transform.mjs` (jscodeshift: literal→`t()`/`getTranslations`/`useFormatter`, server/client-aware; attribute kinds too) + `guard.mjs` (jsx-no-literals override emitter — `*`-globbed dynamic routes, `eslint --print-config` self-verify) + `engine/parity.mjs` (emit + verify recursive key-path parity test).
- `tests/transform.test.mjs` (fixture in→out), `tests/guard.test.mjs`, `tests/parity.test.mjs`.
- **AC:** codemod extracts a fixture (text + placeholder + aria-label) correctly; picks `getTranslations` for a server file and `useTranslations`/`useFormatter` for a client file; guard globs `s/*/page.tsx` (never `[shareId]`) and self-verifies; parity test catches a missing AND an extra key.

### M8 — `localize` SKILL: the mutating loop · effort L · deps: M3, M4, M6, M7
- Flesh `skills/localize/SKILL.md`: extract→wire→translate→guard with confidence routing (high auto-write+backup / medium stage / low inline-only), per-file backup + rollback, idempotent/resumable, test-harness collateral (wrap existing component tests). `skills/first-run-setup/SKILL.md` + `schemas/config.schema.json`.
- **AC:** runs the loop on a fixture app; confidence routing honored; backup + rollback works; a second run converges (no re-extraction); a touched component's existing test gets the provider wrapper.

### M9 — Router + evolve hooks + guide · effort S · deps: M3, M4, M8
- `skills/router/SKILL.md` (state-aware next-move; first-run → scan; never auto-fires a mutating step), `skills/guide/SKILL.md` (persona), `skills/{session-logger,friction-logger,evolve-lingual}/SKILL.md` placeholders with reserved `~/.claude/plugins/data/vibe-lingual/` paths.
- **AC:** bare `/vibe-lingual` recommends the right next move from cached state; placeholders documented, no implementation.

### M10 — Full dogfood on Celestia3 (aaa) · effort M · deps: M3, M4, M8, M9
- End-to-end on a clean Celestia3 checkout: scan → audit → localize ONE un-extracted surface; tests green after; backup/rollback exercised; regression oracle holds (4 done surfaces untouched/not re-flagged).
- **AC:** the spec's validation approach passes on the real app; capture a dogfood report under `docs/dogfood/`. Any P0 the tests missed gets fixed here (expect one — the cowpath/vibe-walk lesson).

### M11 — Documentation & Security Verification · effort M · deps: all
- README (builder-voice, the scan→audit→localize story + the adapter-seam honesty), `guide` cross-check, secrets scan (no keys; translation uses the app's own configured LLM only), dependency audit (jscodeshift/jest/babel), plugin-validator PASS, a `vitals` self-test, docs/ cleanup.
- **AC:** validator PASS; `npm audit` clean or documented; no secrets; README complete; all prior ACs re-confirmed.

---

## Build posture
Subagent-driven where milestones are independent (engine units, adapter pieces); inline for the tight SKILL-wiring integration beats. Commit per milestone. Dogfood at M2 (early) and M10 (full) — never trust structural-green alone. ~12 milestones, vibe-walk-scale.

## Next
`/build` — execute the milestones. (Checkpoint with Este before kicking off — this is the heavy lift.)
