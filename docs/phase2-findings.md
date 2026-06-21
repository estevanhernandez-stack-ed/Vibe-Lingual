# Phase 2 run 1 — Celestia3 dogfood findings (the evolve seed)

> The first at-scale run of vibe-lingual's `localize` on real Celestia3 (66 files / 900 sites). The meta-dogfood: the plugin localizing the app it was born from. This is the seed for Phase 3 (evolve for release) — the full run surfaced what the M10 single-surface dogfood could not.

## What landed (Celestia3 `feat/vibelingual-phase2`, PR)
- **~39 components extracted** to next-intl (en), **220-key en catalog** (merged into the flat `messages/en.json` cowpath layout).
- 22 auto-write (high-confidence) + 4 reviewed-and-promoted from staging.
- **19 files** ratcheted to `react/jsx-no-literals: error`.
- Parity test reworked from strict-equality to **en-source-of-truth + tolerated untranslated backlog** (es/ja carry 0 extra/orphan keys — the real drift signal is clean; the ≤25-key untranslated backlog is expected, translation is the follow-up).
- **Verified green:** 592/592 tests (93 suites), `tsc --noEmit` clean, lint 0 errors. The engine auto-wrapped co-located tests in `NextIntlClientProvider` (the M10 fix held at scale — `collateralTestsNeedManualWrap=0`).

## NOT in this run (the honest frontier)
- **17 heavy components (~512 keys)** — CosmicCalibration, DashboardShell, OnboardingExperience, NatalCompass, GrimoireView, TodayView, etc. The plugin routed them **inline-only (low confidence)** — dense interpolated/mixed content it refused to auto-rewrite. These are the Phase-3 manual / engine-improvement frontier (and they hold the majority of the remaining strings).
- **Translation** (es/fr/de/pt/it/ja/zh/ko/hi) — deliberate follow-up; this run was extraction + en only.

## The 2 codemod bugs the at-scale run surfaced (Phase-3 evolve targets)

### BUG-1 — Server/client misclassification (HIGH — blocks completion)
**Symptom:** a component with NO `'use client'` directive that uses client-only hooks (`useState`, `useAuth`, `useSubscription`, …) was treated as a server component and rewritten to `export default async function` + `getTranslations`. Invalid — an async/server component cannot call `useState`; breaks build/runtime.
**Hit:** WelcomeModal, ManageSubscription, UpgradeModal (staged → **rejected** by review), and several auto-written files (caught by lint `react-hooks/rules-of-hooks` → fixed in commit `7b442e6`).
**Root cause:** the codemod's server/client heuristic assumes "no `'use client'` ⇒ server." In Next App Router, a component without the directive that is imported into a client tree is STILL a client component. 
**Fix direction:** treat a component as CLIENT when it uses any client-only hook (`useState`/`useEffect`/`useReducer`/`useContext`/`useRef`/`useCallback`/`useMemo`/`useLayoutEffect` or any custom `use*` hook) OR contains event handlers (`onClick`…), regardless of the directive. Only choose `getTranslations` (server) when the component is `async` AND has no client-hook/handler usage. Add fixtures for: no-directive + useState (client), no-directive + pure render (server), explicit `'use client'`.
**This bug GATES Phase-2 completion** — many of the rejected + remaining components share this pattern; they cannot be reliably extracted until it is fixed.

### BUG-2 — Module-scope `t()` in dynamic-import loading closures (MEDIUM)
**Symptom:** `t('loadingMap')` emitted inside a `dynamic(() => import(...), { loading: () => (<div>{t('loadingMap')}</div>) })` closure at module scope (AstrocartographyView.tsx:49), but `t` is only defined inside the component body (`useTranslations` at line 103). Result: `ReferenceError: t is not defined` at render. Caught by the test gate → rolled back via engine `--rollback` (source + collateral test + en.json all restored, ledger pruned — the rollback machinery worked correctly).
**Fix direction:** the codemod must only rewrite a string literal when the `t`/`getTranslations` binding is in scope at that literal's position. A literal inside a closure defined OUTSIDE the component body (module-scope `dynamic(...)` options, top-level constants) must be left as inline-only (or the hook hoisted appropriately — but inline-only is the safe default). Add a scope-reachability check before rewrite; fixture: a `dynamic(..., { loading })` closure literal.

## What this validates
- **Structural-green ≠ works, at scale.** 262 plugin unit tests + the M10 single-surface dogfood were green; the 66-file real run still found 2 real bugs. The full-volume dogfood (Phase 2) is a stronger gate than any single-surface test — exactly why the arc has Phase 2 feed Phase 3.
- **The plugin's safety machinery worked.** Confidence routing kept the risky transforms OUT of auto-write (staged for review); the reviewer rejected the broken ones; the test gate caught the one that slipped through (rolled back cleanly); lint caught the auto-written misclassifications (fixed). No broken code reached a green branch. The rails held.

## Run 2 (fixed codemod) — outcome + the next wall

BUG-1 + BUG-2 fixed in the plugin (commit `15aa47a`, 274 tests; both validated on the real failing components — WelcomeModal/ManageSubscription/UpgradeModal now transform to client `useTranslations`, AstrocartographyView's loading-closure literal stays inline). Re-ran Phase 2: **all 4 previously-rejected files extracted cleanly**, en catalog **220 → 302 keys**, **41 components total**, suite still green (592/592, lint 0, tsc clean).

**The next wall — BUG-3 (confidence scoring, MEDIUM):** the codemod fix improved OUTPUT QUALITY (correct client/server) but did NOT change CONFIDENCE ROUTING — confidence is computed in **scan/audit**, not `transform.mjs`. So the **~13 heavy components** (CosmicCalibration, DashboardShell, OnboardingExperience, NatalCompass, GrimoireView, TodayView…) stay **inline-only (low confidence)** and the plugin still won't auto-extract them. They hold most of the remaining strings (dense interpolated/mixed content).
**Fix direction:** the scan/audit confidence heuristic is too conservative on dense components — a single interpolated/ambiguous site pulls a whole large file to low. Options: (a) per-SITE routing instead of per-FILE (extract the high-confidence sites in a heavy file, leave the genuinely-ambiguous ones inline) — the highest-value change; (b) raise confidence for now-safe patterns the codemod fix made reliable; (c) accept that the densest narrative components stay a manual pass. **(a) is the recommended evolve target** — per-site routing would unlock the bulk of the frontier without forcing risky whole-file rewrites.

**Phase-2 status:** the plugin has extracted everything it can CONFIDENTLY do (41 components / 302 keys, green). Full completion of the heavy frontier needs the BUG-3 per-site-routing evolve pass OR manual extraction. Translation (es/fr/de/pt/it/ja/zh/ko/hi for the 302 keys) is the orthogonal follow-up axis.
