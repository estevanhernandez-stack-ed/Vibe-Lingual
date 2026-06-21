# Reflection — vibe-lingual (Cart cycle #17)

> Phase 1 of the 4-phase vibe-lingual arc. The plugin is built, dogfood-proven on Celestia3, and structurally complete at v0.1.0 — local/canary-ready, not yet shipped to the family.

## What landed
A markdown/SKILL-driven Claude Code plugin that takes a web app from hardcoded UI strings to localized UI: **`/vibe-lingual` (router) + `:scan` + `:audit` + `:localize`**, over a Node/jscodeshift engine.
- **Engine:** detect → scan (string-site inventory by kind + the six-block brief) → audit (gotcha rules + readiness + phased plan) → extract (the codemod) + backup/rollback + parity.
- **next-intl adapter, deep:** wire() (request.ts with AVAILABLE+fallback, locale-cookie, provider mount, jest ESM patch), the transform codemod (server/client-aware: `getTranslations`/`useTranslations`/`useFormatter` with per-call resolved timeZone), the guard emitter (`jsx-no-literals`, `*`-globbed dynamic routes, print-config self-verify).
- **Adapter seam, real:** registry dispatches; non-next-intl apps get an honest "not-yet-implemented" verdict, never a wrong-handling mutation.
- **Confidence-routed, safe mutation:** high auto-write+backup / medium stage / low inline-only; idempotent/resumable; per-file backup + exact rollback; test-harness collateral (wraps a touched component's existing tests in the provider).
- **262 tests**, 24 commits, the 3 self-evolving placeholders, README, plugin-validator clean.

## How it was built — 5 workflows in sequence, verified between
Under ultracode, the build ran as **five sequential Workflow phases** (M0-M2 / M3-M5 / M6-M7 / M8-M9 / M10-M11), each: implement → **parallel multi-lens adversarial verify** (spec + correctness + a mutation-safety lens on the write side) → bounded fix loop, plus **Celestia3 dogfood gates** (scan at M2, audit at M4, codemod at M7, localize at M8, full end-to-end at M10). The controller (me) hands-on re-verified the foundation between every phase.

## What worked
- **Cowpath-first → seed → Cart build (pattern eee, confirmed a 2nd time).** The cowpath gotchas baked into the ACs meant the engine got the hard calls RIGHT from the first implementation: structural-vs-presentational Intl exclusion, the timeZone policy (per-call resolved zone, not global UTC), the eslint `[param]`-glob trap, the jest-ESM `transformIgnorePatterns` patch. None of these were re-discovered the hard way — they were specified.
- **Adversarial verify + dogfood at every phase caught real bugs.** Every phase had fix commits where the verifiers or dogfood bit (locale-pref regex matching usage not declaration; props-interface false-positive; runtime-tz structural idiom; catalog-layout mismatch; ancestor `__tests__` walking; rollback not cleaning created catalogs).
- **Controller-verifies-between caught a false alarm AND confirmed the crux.** My hands-on audit spot-check looked like a contradiction — re-verifying directly proved it was my own bad `/tmp` invocation, not a plugin bug (the audit was correct). And running the codemod myself on a real component (30 readable keys, idempotent, valid TSX) confirmed the hardest piece independently.
- **Worktree-isolated dogfood kept the live app pristine.** M10 mutated a git worktree of Celestia3, ran its suite, rolled back, removed the worktree — the real Celestia3 working tree was never touched.

## The headline lesson (3rd recurrence — now a law)
**The M10 full dogfood caught 3 P0 defects the 245 unit tests missed** (catalog-layout mismatch, ancestor `__tests__` walking, rollback not cleaning created catalogs). Structural-green ≠ works — *again*. This is the third cycle it has bitten (RTClickPng/SnipSnap deploy-state, Vibe-Walk's verdict P0, now this). The rule is load-bearing: **a real-app end-to-end dogfood is non-negotiable before a build is "done," no matter how green the unit suite.** The dogfood gates earned their entire cost in this one finding.

## What to tighten next time
- **Dogfood the FULL localize surface earlier.** M2 (scan) and M8 (localize-on-a-copy) dogfooded early and well, but the 3 P0s only surfaced at M10's *full* end-to-end run (real catalog layout, real ancestor test dirs, real rollback-of-created-files). A full end-to-end localize dogfood at M8 — not just a single-component copy — would have caught them ~2 phases sooner. The lesson generalizes: the dogfood must exercise the *messy real* path (existing catalogs, real test-dir nesting), not a clean fixture.
- **One robustness Minor I had to fold in mid-build:** `audit` silently degraded to an RTL-only report when handed a missing/empty inventory path (a Windows `/tmp` write that never landed). Fixed to fail-loud in M8. Engines that take a path input should fail loud on empty/missing input, never emit a plausible-but-empty report.
- **Agent narration drift:** a Phase-4 agent described work as "from the prior session" — confused but harmless (commits were real, tree clean). Worth noting that background-workflow agents can mis-narrate provenance; trust the git log over the prose.

## How I worked
Fully-autonomous, spec-prepped-upstream (the cowpath seed was the substrate). Zero deepening rounds at scope/prd/spec — the vision was formed — except one compact decision matrix at /scope on the two load-bearing forks (command surface, adapter breadth), picked decisively. The whole discovery chain compressed; the value landed at /checklist + /build, as it has for the last several cycles.

## Remaining arc
- **Phase 2:** run vibe-lingual on Celestia3 to completion (~60 remaining components, all 10 locales — the plugin does the volume it was built for).
- **Phase 3:** evolve for release (the L3 loop over Phase-2 friction) + ship to the family (public solo repo + `marketplace.json` entry).
Both Este-gated; not started.
