# Vibe-Lingual

Localize your app's UI without corrupting its logic.

Most i18n retrofits break two ways: they miss strings hiding in attributes (placeholder, aria-label, title, alt), and they extract things that were never display text in the first place — locale-tagged math, calendar arithmetic, format keys. Vibe-Lingual draws that line. It scans every user-facing string by kind, audits the stack for the gotchas that bite the retrofit, then runs a confidence-routed, backed-up, idempotent loop that mutates only what it should.

Part of the [Vibe plugin family](https://github.com/estevanhernandez-stack-ed/vibe-plugins). Deep on next-intl + App Router; honest about the rest.

## The arc

| Command | What it does | Mutates? |
|---|---|---|
| `/vibe-lingual` | State-aware router — recommends your next move | no |
| `/vibe-lingual:scan` | Inventory strings by kind + emit a six-block readiness brief | no |
| `/vibe-lingual:audit` | Stack gotchas, per-file readiness, phased plan | no |
| `/vibe-lingual:localize` | Extract -> wire -> translate -> guard | yes (confidence-routed) |
| `/vibe-lingual:vitals` | Structural self-test of the plugin install | no |

## How it draws the line

- **Scanner owns attribute literals.** ESLint reliably catches JSX text but is noisy on attributes; the scanner detects placeholder / aria-label / title / alt itself rather than delegating.
- **Structural vs presentational Intl.** Locale-tagged math (`'en-US'` in tz-offset arithmetic) is flagged structural and never auto-extracted. Display strings are. The distinction is a scan-time classification confirmed at audit time.
- **The adapter seam is real.** next-intl + App Router is implemented deep. Any other framework gets an honest `not-yet-implemented` — never wrong-handling.

## The next-intl adapter

Cookie-driven locale (no `/[locale]/` URL routing for preference-based apps), catalog parity guard (recursive key-path equality — catches missing AND extra keys), a `jsx-no-literals` ratchet flipped per fully-extracted file, the ESM `transformIgnorePatterns` jest patch, and the `timeZone` decision surfaced as a prompt rather than auto-resolved.

## Status

v0.1.0. The full scan -> audit -> localize loop and the next-intl adapter (wire + transform + guard + parity) are built and dogfooded end-to-end on Celestia3: scan reproduces the six-block brief with accurate counts and leaves the already-localized surfaces untouched, audit flags the stack gotchas (structural-Intl, the timeZone decision, RTL, the dynamic-route glob), and localize extracts a real surface with per-file backup, idempotent re-runs, and a clean rollback — the app's own test suite staying green through the loop. Run `/vibe-lingual:vitals` for a structural self-test of the install.

## Install

Stable channel via the [vibe-plugins marketplace](https://github.com/estevanhernandez-stack-ed/vibe-plugins). Canary tracks `main` on this repo.

## License

MIT — 626Labs LLC.
