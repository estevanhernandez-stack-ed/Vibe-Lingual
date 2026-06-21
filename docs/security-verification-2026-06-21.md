# M11 — Security & dependency verification (Cart cycle #17)

Date: 2026-06-21. Plugin: `plugins/vibe-lingual/` v0.1.0. Run as the final milestone before tagging.

## Secrets scan — CLEAN

Pattern sweep across the plugin tree (manifest, commands, all ten SKILLs, the engine, schemas, tests) for `api[_-]?key`, `secret`, `token`, `bearer`, `password`, `AKIA`, `sk-`, `AIza`, `ghp_`, PEM headers, `client_secret`. **No keys, tokens, or credentials anywhere.** The only matches were:

- The literal word "token" inside the CSS-token classification logic (`engine/scan.mjs`, `engine/adapters/next-intl/transform.mjs`) — false-positive detection of Tailwind/utility-class strings, not a credential.
- The npm package name `js-tokens` in `package-lock.json`.
- The documented no-secrets policy in `skills/guide/SKILL.md` and `skills/first-run-setup/SKILL.md`.

**Translation uses the target app's own configured LLM.** vibe-lingual never ships its own API key and never calls its own external service. The translate phase of the `localize` loop dispatches against the app's already-present, already-keyed LLM. Detection, scan, audit, codemod, and parity are deterministic Node — zero LLM calls. No telemetry: nothing leaves the target app or `~/.claude/plugins/data/vibe-lingual/`. This is stated in `guide/SKILL.md` and the README.

## Dependency audit — PROD CLEAN, dev advisories documented

| Scope | Vulnerabilities |
|---|---|
| `npm audit --omit=dev` (production tree) | **0** (info 0 / low 0 / moderate 0 / high 0 / critical 0) |
| `npm audit` (full tree, dev included) | 18 moderate / 0 high / 0 critical |

**The 18 moderate advisories are entirely in the jest/babel/istanbul test toolchain** — roots: `jest`, `jest-config`, `jest-runtime`, `jest-circus`, `jest-runner`, `jest-cli`, `jest-snapshot`, `@jest/*`, `babel-jest`, `babel-plugin-istanbul`, `create-jest`, `@istanbuljs/load-nyc-config`, `js-yaml`. The underlying CVE is the `js-yaml` transitive used by istanbul coverage config loading. These are **dev-only**:

- They never ship to users. The plugin is delivered through the Claude Code marketplace as a `git-subdir`, and `package.json` is `private: true` (not an npm-published package).
- They never run inside a target app. The engine runs from the repo checkout; the only thing it does in a user's app is read source and (on `localize`) write catalogs + wired files.
- The fix path (`npm audit fix --force`) would force a jest major bump — a breaking change to the test toolchain with no security benefit to anyone, since the vulnerable code never executes outside `npm test` in this repo. **Not applied.** Revisit if jest publishes a non-breaking patched line.

### Runtime-dependency reclassification (fixed this milestone)

The engine imports `@babel/parser` and `jscodeshift` at runtime (`engine/scan.mjs`, `engine/adapters/next-intl/transform.mjs`), but both were listed under `devDependencies` while `dependencies` was empty. Moved both to `dependencies`; `@babel/core` and `jest` stay in `devDependencies` (test-only). `@babel/parser` and `jscodeshift` pull **no vulnerable transitives** into the production tree — `npm audit --omit=dev` remains 0 after the move. Lockfile regenerated; 262 tests still green.

## Plugin-validator — PASS (20/20)

- Manifest `.claude-plugin/plugin.json` parses; `name` / `version` / `description` / `author` all present; `version === 0.1.0`.
- All 10 SKILL directories carry a `SKILL.md` with valid `---`-delimited frontmatter (non-empty `name` + `description`).
- All 5 command files (`vibe-lingual`, `scan`, `audit`, `localize`, `vitals`) invoke a skill that exists.

## Self-test — `/vibe-lingual:vitals`

A read-only structural self-test (`skills/vitals/SKILL.md` + `commands/vitals.md`) ships per the family vitals convention. It checks the manifest, all nine arc SKILLs, the nine engine modules + CLI dispatch, the next-intl adapter pieces, the five templates (including the jest-patch ESM allowlist + the `.vibe-lingual/` test-ignore the M10 dogfood proved load-bearing), the three schemas, and the test suite. Clean install renders `8 ✓ · 0 ⚠ · 0 ✗`.

## Tests

`npm test` (the only correct invocation — needs `--experimental-vm-modules` for native-ESM `.mjs`; bare `npx jest` will report a false ESM failure): **262 passed, 12 suites.**

## Verdict

No secrets. Production dependency tree clean. Dev-only advisories documented and consciously not force-fixed. Validator PASS. Self-test shipped. M11 complete.
