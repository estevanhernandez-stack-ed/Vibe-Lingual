---
name: vitals
description: "This skill should be used when the user says `/vibe-lingual:vitals` or wants a structural integrity check on the vibe-lingual install. Runs read-only structural checks against the plugin's manifest, SKILLs, engine modules, next-intl adapter, and schemas, and reports findings in a banner-style report. Implements Pattern #8 (Plugin Self-Test) from the Self-Evolving Plugin Framework. Read-only — no auto-fix."
---

# /vibe-lingual:vitals — structural self-test

Slash command `/vibe-lingual:vitals`. Runs **read-only** structural checks against the installed plugin files, reports findings in a banner-style report with per-check status (✓ pass, ⚠ warn, ✗ fail), and prints a summary line. No writes, no auto-fix.

This is Pattern #8 (Plugin Self-Test) from the Self-Evolving Plugin Framework. vibe-lingual carries a 9-module engine, a deep next-intl adapter (wire + transform + guard + templates), three JSON schemas, and nine SKILLs that cross-reference each other. A missing engine module or a deleted template surfaces as a cryptic error mid-localize at the worst possible moment — the middle of a confidence-routed auto-write. Vitals makes the structural state visible in one pass: cheap to run, hard to misread.

## Before You Start

Read [`../guide/SKILL.md`](../guide/SKILL.md) for the i18n-retrofit persona and posture. Vitals applies the voice to the opening line only — the report body is neutral.

## Session Logging

Call `session-logger.start("vitals", project_dir_basename)` at command start. Hold the returned `sessionUUID`. At command end, call `session-logger.end()` with `outcome: "completed"` on a clean run, `"partial"` if a check could not run due to an unreadable file, `"error"` only if the command crashed before the summary rendered, and `key_decisions` carrying short strings for notable findings (e.g., `"engine/parity.mjs absent"`, `"next-intl template missing"`).

## Friction Logging

Vitals does **not** call `friction-logger.log()`. Running a structural self-test is not friction. The absence here is auditable per the friction-triggers contract.

## Persona Adaptation

One-sentence opening before the report renders:

```
Running structural sweep — checking plugin.json, all nine SKILLs, the engine modules, the next-intl adapter + templates, the schemas, and the test suite.
```

Then render the report. No narration between checks.

## Runtime Paths

All paths vitals reads (never writes). Walk up from this SKILL file to the plugin root `plugins/vibe-lingual/`.

| What | Where |
|------|-------|
| Plugin manifest | `.claude-plugin/plugin.json` |
| SKILL files | `skills/*/SKILL.md` |
| Command files | `commands/*.md` |
| Engine modules | `engine/{cli,detect,scan,brief,audit,audit-report,extract,backup,parity}.mjs` |
| Adapter | `engine/adapters/index.mjs`, `engine/adapters/adapter.contract.md` |
| next-intl adapter | `engine/adapters/next-intl/{index,wire,transform,guard}.mjs` |
| next-intl templates | `engine/adapters/next-intl/templates/*.template` |
| Schemas | `schemas/{inventory,audit,config}.schema.json` |
| Tests | `tests/*.test.mjs` |

If any path is unreadable for reasons other than "does not exist" (permission denied, I/O error), the affected check reports `✗ fail` with the error surfaced verbatim.

## Flow

1. Write the persona-adapted opening line.
2. Read `plugin.json` version. Fall back to `"unknown"` on parse failure. Capture local ISO datetime for the banner.
3. Run checks #1 through #8 in order. A failure in one check never aborts the next — the report always includes all eight sections.
4. Render the report (banner + per-check boxes + summary line).
5. Print the closing advisory.
6. Call `session-logger.end()`.

## Check Specifications

### Check #1 — plugin.json valid + required fields present

**Read** `.claude-plugin/plugin.json`. **Evaluate:** missing → ✗ fail; unparseable → ✗ fail with the parse error; parseable → verify `name`, `version`, `description`, `author` all present and non-empty. **Report:** ✓ pass includes `name: <name>, version: <version>`; ✗ fail lists each issue.

### Check #2 — All nine SKILL directories + SKILL.md files present with valid frontmatter

**Read** these nine skill directories under `skills/`:

```
router    guide    scan    audit    localize
first-run-setup    session-logger    friction-logger    evolve-lingual
```

(`vitals` itself is the tenth and is implicit — it is running.) For each, confirm `SKILL.md` is present and its `---`-delimited YAML frontmatter has non-empty `name` + `description`. **Report:** ✓ pass `9 SKILL.md files, all frontmatter valid`; ⚠ warn for present-but-incomplete frontmatter (loads but may not surface in the available-skills list); ✗ fail lists each absent `skills/<dir>/SKILL.md — missing`.

### Check #3 — Engine modules present + CLI dispatches every subcommand

**Read** the nine engine modules: `cli.mjs`, `detect.mjs`, `scan.mjs`, `brief.mjs`, `audit.mjs`, `audit-report.mjs`, `extract.mjs`, `backup.mjs`, `parity.mjs`. Then read `cli.mjs` and confirm its `SUBCOMMANDS` array still lists `scan`, `audit`, `extract`, `wire`, `parity`, `detect`. **Report:** ✓ pass `9/9 engine modules present, 6 subcommands wired`; ✗ fail lists each missing module and any subcommand dropped from dispatch.

### Check #4 — next-intl adapter pieces present

**Read** `engine/adapters/index.mjs`, `engine/adapters/adapter.contract.md`, and the four next-intl files `engine/adapters/next-intl/{index,wire,transform,guard}.mjs`. **Report:** ✓ pass `adapter registry + next-intl (wire/transform/guard) present`; ✗ fail lists each missing file. A missing `transform.mjs` or `wire.mjs` means localize cannot mutate — fail-hard.

### Check #5 — next-intl templates present

**Read** `engine/adapters/next-intl/templates/`. Confirm these five templates exist: `request.ts.template`, `locale-cookie.ts.template`, `next.config.plugin.template`, `provider-mount.snippet.template`, `jest-transform-ignore.snippet.template`. **Report:** ✓ pass `5/5 templates present`; ✗ fail lists each missing template. The wired output is empty without them.

### Check #6 — jest patch carries BOTH the ESM allowlist AND the .vibe-lingual test-ignore

**Read** `engine/adapters/next-intl/templates/jest-transform-ignore.snippet.template`. Confirm it contains (a) the ESM allowlist replace string (`next-intl|use-intl|intl-messageformat|@formatjs`) and (b) `testPathIgnorePatterns` with `<rootDir>/.vibe-lingual/`. **Report:** ✓ pass `jest patch: ESM allowlist + .vibe-lingual test-ignore`; ⚠ warn if either half is missing (the Celestia3 dogfood proved both are load-bearing — without the allowlist the suite breaks on next-intl's ESM, without the ignore jest globs the plugin's own backup test copies and they fail). This check guards the two regressions M10 fixed.

### Check #7 — Schemas present + parseable

**Read** `schemas/inventory.schema.json`, `schemas/audit.schema.json`, `schemas/config.schema.json`. Confirm each is present and parses as JSON. **Report:** ✓ pass `3/3 schemas valid`; ✗ fail lists each missing or unparseable schema with the parse error.

### Check #8 — Engine test suite present + green

**Read** the `tests/` directory; confirm the core suites exist (`detect`, `scan`, `audit`, `adapters`, `wire`, `transform`, `guard`, `parity`, `backup`, `extract`, `extract-dogfood-defects`). If the run is from the plugin repo with devDeps installed, optionally run `npm test` (never bare `npx jest` — the suites are native-ESM `.mjs` and need the `--experimental-vm-modules` flag the `npm test` script sets; `npx jest` reports a false "Cannot use import statement outside a module" failure) and capture the pass/fail totals. **Report:** ✓ pass `<N> suites present` (and `<T> tests green` when run); ⚠ warn if a core suite file is absent; ✗ fail if `npm test` was run and any test failed (surface the failing suite name). When devDeps are not installed, this check is presence-only — note it.

## Output Format

### Banner header

```
  Vibe-Lingual — Vitals
  <version> · <ISO-local-timestamp>
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

One blank line before the first check.

### Per-check boxed section

```
  ┌──────────────────────────────────────────────────────────────────┐
  │ ✓  Check 1 — plugin.json valid + required fields present          │
  └──────────────────────────────────────────────────────────────────┘
     name: vibe-lingual, version: 0.1.0
```

Status glyphs: `✓` pass · `⚠` warn · `✗` fail. Two spaces after the glyph. Box width 68 columns. A ✓ pass renders one summary metric line.

### Summary line

After the last box, one blank line, then:

```
  <N> ✓  ·  <N> ⚠  ·  <N> ✗
```

Indented two spaces. The three counts sum to 8.

### Closing advisory

```
Re-run /vibe-lingual:vitals any time to re-check. For structural proposals, see /vibe-lingual:evolve-lingual.
```

## Expected output on a clean install

A fully-shipped install produces `8 ✓  ·  0 ⚠  ·  0 ✗`. The first run before a localize session is the natural time to run this — if anything's missing or drifted, the output names exactly what to fix before the mutating loop starts.

## Cross-references

- Guide (persona + posture): [`../guide/SKILL.md`](../guide/SKILL.md)
- Session logger: [`../session-logger/SKILL.md`](../session-logger/SKILL.md)
- Self-evolution: [`../evolve-lingual/SKILL.md`](../evolve-lingual/SKILL.md)
- The localize loop vitals guards: [`../localize/SKILL.md`](../localize/SKILL.md)
