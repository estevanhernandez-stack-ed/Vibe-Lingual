# Builder Profile — Vibe-Lingual (Cart cycle #17)

> Onboard for the `vibe-lingual` plugin build. Returning, fully-autonomous builder — the 11-step interview is skipped; this captures the cycle framing only. Source profile: `~/.claude/profiles/builder.json` (all fields fresh as of 2026-04-25).

## Builder
- **Estevan** ("Mr. Solo Dolo"), 626Labs, Fort Worth. Vibe coder — architects and ships through AI agents. Active Vibe Cartographer contributor; 16 Cart cycles completed.
- **Persona:** architect. **Tone:** terse, direct, no corporate speak. **Pacing:** brisk. **Autonomy:** `fully-autonomous`. **Build mode:** `iterative-prototype`. **Cycle builder:** self.
- **Operating pattern (mm):** spec-prepped upstream, Cart wraps the build. Value lands at /checklist + /build, not the discovery end. Zero deepening rounds when the vision is formed — and it is (rich cowpath seed). Course-corrects 2-3x per long command on load-bearing decisions; otherwise the chain flows.

## Project
**vibe-lingual** — the i18n/localization member of the vibe-* plugin family. A Claude Code plugin that takes an app from "hardcoded UI strings" to "localized UI" by doing the work a human would: detect the framework + existing i18n, inventory the string surface, extract to catalogs, wire the framework + locale, translate, and lock it with guards. Emits a standard six-block scan brief for any repo it's pointed at.

**This is Phase 1 of a 4-phase arc** (Este's shape): Phase 0 cowpath [DONE — shipped on Celestia3, PR #92 merged] → **Phase 1 build the plugin (this cycle)** → Phase 2 run the plugin on Celestia3 to completion (~60 components, all 10 locales) → Phase 3 evolve for release + ship to the family.

### Goals
1. Build `vibe-lingual` as a markdown-driven Claude Code plugin matching the 13 marketplace siblings' conventions.
2. Ground every command in the cowpath seed (`docs/inputs/cowpath-seed.md`) — the framework choice, the 6-block scan template, and the hard-won gotchas are evidence, not guesses.
3. Autonomous-first read (scan/audit) with interview gates on the soft, per-app decisions (framework pick when ambiguous, dual-locale model, timeZone policy, RTL).
4. Be dogfoodable on Celestia3 immediately (Phase 2 is the dogfood) — and generalize beyond it.

## Architecture (substrate)
- **Type:** Claude Code plugin (CLI-only, markdown/SKILL-driven). Same shape as Vibe-Walk / vibe-taker / vibe-doc.
- **Solo repo:** `C:\Users\estev\Projects\Vibe-Lingual` (local-first; no GitHub remote yet — confirm before any public surface, per the harness per-command gate, pattern oo).
- **Deployment target:** `vibe-plugins-marketplace`. Solo repo on canary; `marketplace.json` ref-bump on stable. Tag naming: plain `vX.Y.Z` (the family default; NOT the `<plugin>-vX.Y.Z` Test/Sec form).
- **Reference siblings for structure:** vibe-doc (autonomous codebase read → docs), vibe-prompt (scan → audit → remediate loop over prompt sites), vibe-walk (discover → verdict → emit). vibe-lingual is closest to **vibe-prompt's scan→audit→remediate shape**, applied to i18n string sites instead of prompt sites.

## Tenant
626Labs / personal estate. NOT Marcus. 626 dashboard logging applies (bound to "Vibe Plugins" project, `tyWzqAbCAq6Y9UJvoy8t`).

## Next
`/scope` — refine the plugin's command surface and v1 boundary from the seed. Expect compression (the seed is the substrate); the value is the asking, even when the answer is "the seed already settled it."
