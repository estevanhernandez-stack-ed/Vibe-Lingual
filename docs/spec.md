# Spec — vibe-lingual (Cart cycle #17)

> Technical blueprint from `prd.md`. Mirrors the vibe-prompt/vibe-walk sibling structure (commands/ + schemas/ + skills/<name>/SKILL.md + tests/, manifest at `.claude-plugin/plugin.json`) and the family pattern of SKILL orchestration + a deterministic engine for the AST-heavy mechanical work. Input to /checklist.

## Stack
- **Orchestration:** SKILL.md files (markdown) — soft decisions, interview gates, the six-block brief narrative, confidence routing.
- **Engine:** Node CLI (the AST-heavy work is JSX/TS — JS is the right tool, same reasoning as vibe-walk's jscodeshift anchor codemod). `jscodeshift`/`@babel/parser` for scan + extract; plain Node for detection, audit rules, brief assembly, parity emit/verify. **No Python** — the work is all JS-AST; one language keeps it tight.
- **Tests:** `jest` (matches Celestia3 + family). Engine unit tests + codemod fixture tests + a dogfood smoke against Celestia3.
- **Target-app deps it installs/edits:** `next-intl` (the v1 adapter); patches `jest.config`, `next.config`, `eslint.config`, `src/i18n/*`, `messages/*`.

## Plugin file layout (solo repo `Vibe-Lingual`, marketplace path `plugins/vibe-lingual`)
```
plugins/vibe-lingual/
  .claude-plugin/plugin.json          # loader-recognized manifest (the ONLY recognized location)
  commands/                           # slash-command → skill wiring
    vibe-lingual.md                   #   /vibe-lingual            → router
    scan.md                           #   /vibe-lingual:scan       → scan
    audit.md                          #   /vibe-lingual:audit      → audit
    localize.md                       #   /vibe-lingual:localize   → localize
  skills/
    router/SKILL.md                   # state-aware next-move recommender (never auto-fires)
    guide/SKILL.md                    # persona / how-to (family convention)
    scan/SKILL.md                     # read-only inventory + six-block brief
    audit/SKILL.md                    # read-only gotcha + readiness analysis
    localize/SKILL.md                 # the mutating loop (extract→wire→translate→guard)
    first-run-setup/SKILL.md          # capture framework + adapter + config on first run
    session-logger/SKILL.md           # placeholder (reserved data path)
    friction-logger/SKILL.md          # placeholder (reserved data path)
    evolve-lingual/SKILL.md           # placeholder (L3 self-evolution, reserved)
  schemas/
    inventory.schema.json
    audit.schema.json
    config.schema.json
  engine/                             # the deterministic Node CLI
    cli.mjs                           # dispatch: scan | audit | extract | wire | parity | detect
    detect.mjs                        # framework + router + SSR + existing-i18n detection
    scan.mjs                          # string-site inventory by kind (AST + attr walk)
    audit.mjs                         # gotcha rules + readiness + phased plan
    brief.mjs                         # assemble the six-block markdown brief
    parity.mjs                        # emit + verify recursive key-path parity test
    adapters/
      index.mjs                       # adapter registry: detect → dispatch
      adapter.contract.md             # the FrameworkAdapter interface (the seam)
      next-intl/                      # v1 adapter — IMPLEMENTED DEEP
        index.mjs
        wire.mjs                      # emit request.ts, locale-cookie, provider, jest patch
        transform.mjs                 # jscodeshift codemod: literal → t()/getTranslations/useFormatter
        guard.mjs                     # eslint jsx-no-literals override emitter (glob-safe)
        templates/                    # request.ts, locale-cookie.ts, parity.test, provider snippet
      _stubs/                         # react-i18next, pages-router, vue-i18n → "not yet implemented"
  tests/
    *.test.mjs                        # engine units
    fixtures/                         # tiny app trees for codemod + scan tests
  README.md
```

## SKILL contracts (inputs → outputs)
| SKILL | Reads | Writes | Mutates target? |
|---|---|---|---|
| `router` | `.vibe-lingual/state/*` | — (recommendation only) | no |
| `scan` | target source | `.vibe-lingual/state/inventory.json` + `docs/vibe-lingual/scan-YYYY-MM-DD.md` (six-block brief) | no |
| `audit` | `inventory.json` | `.vibe-lingual/state/audit.json` + `docs/vibe-lingual/audit-YYYY-MM-DD.md` | no |
| `localize` | `inventory.json` + `audit.json` + adapter | catalogs, wired files, guard, backups | **yes** (confidence-routed) |
| `first-run-setup` | target | `.vibe-lingual/config.json` | no |

## State schemas

**`inventory.json`**
```json
{
  "schemaVersion": 1,
  "app": { "root": "string", "framework": "next-intl|react-i18next|...|none", "routerType": "app|pages|unknown", "turbopack": true, "ssrFiles": ["..."] },
  "existingI18n": { "lib": "string|null", "languageList": {"file":"...","symbol":"SUPPORTED_LANGUAGES"} , "localePref": {"file":"...","symbol":"outputLanguage"} },
  "sites": [ { "file":"...","line":0,"kind":"jsx-text|placeholder|aria-label|title|alt|toast|date-intl","text":"...","suggestedNamespace":"...","suggestedKey":"...","confidence":"high|medium|low","structuralIntl":false } ],
  "countsByKind": { "jsx-text":0, "placeholder":0, "aria-label":0, "title":0, "alt":0, "toast":0, "date-intl":0 },
  "componentsByDensity": [ {"file":"...","count":0} ]
}
```

**`audit.json`**
```json
{
  "schemaVersion": 1,
  "gotchas": [ {"type":"firebase-admin-ssr|structural-intl|timezone|rtl|dynamic-route-glob","file":"...","line":0,"severity":"block|warn|info","recommendation":"..."} ],
  "decisions": [ {"id":"timezone|dual-locale|html-lang","question":"...","options":["..."],"recommended":"..."} ],
  "readiness": [ {"file":"...","status":"ready|blocked","reason":"..."} ],
  "phasedPlan": [ {"phase":"extract|wire|translate|wire-to-locale|guard","items":["..."]} ]
}
```

## Adapter interface (the seam)
```
FrameworkAdapter {
  id: string                                  // 'next-intl'
  matches(detection): boolean                 // claim this app?
  wire(ctx): WiredFileSet                     // emit request.ts, locale-cookie, provider mount, jest patch, AVAILABLE+fallback
  transform: jscodeshiftTransform             // literal → t()/getTranslations/useFormatter, server/client-aware
  emitParityTest(locales): File
  emitGuard(extractedFiles): EslintOverride   // jsx-no-literals, '*'-globbed dynamic routes, print-config verified
  capabilities: { ssr, cookieLocale, dateFormatter, dualLocale }
}
```
Registry `adapters/index.mjs`: `detect → first matching adapter`. v1 registers **next-intl only**; any non-match returns `{adapter:null, framework:<detected>, status:"not-yet-implemented"}` — `localize` refuses to mutate and reports cleanly (PRD Epic 4 AC2).

## plugin.json
```json
{
  "name": "vibe-lingual",
  "version": "0.1.0",
  "description": "<rich one-paragraph: scan→audit→localize UI i18n; six-block brief; next-intl/App-Router adapter deep, adapter seam for the rest; cookie-driven locale, parity guard, jsx-no-literals ratchet; validated on Celestia3>",
  "author": { "name": "626Labs LLC", "url": "https://github.com/estevanhernandez-stack-ed/Vibe-Lingual" }
}
```

## Key technical decisions (KTDs)
- **KTD-1 — Engine in Node, not Python.** The work is JSX/TS AST (scan + codemod); jscodeshift/babel is the right tool. One language. (Deviates from some siblings' Python-logic layer — justified by the AST-native workload.)
- **KTD-2 — `localize` is confidence-routed + backed-up + idempotent.** High→auto-write w/ backup, medium→stage, low→inline-only. Re-runnable to convergence (Phase 2 mode). Never half-writes a catalog (atomic per file).
- **KTD-3 — Adapter seam is real from v1, but only next-intl is implemented.** Non-match → honest "not-yet-implemented", never wrong-handling. (PRD Epic 4.)
- **KTD-4 — Scanner owns attribute-literal detection; ESLint owns only JSX-text.** Per the cowpath lesson. Guard emitter globs dynamic routes with `*` and verifies via `eslint --print-config`.
- **KTD-5 — Structural vs presentational Intl is a scan-time classification + an audit-time confirmation gate**, never an auto-extract. (Protects chart-math-class logic.)
- **KTD-6 — Marketplace conventions:** manifest only at `.claude-plugin/plugin.json`; layout under `plugins/vibe-lingual/`; plain `vX.Y.Z` tags; canary solo repo + stable ref-bump. (Family contracts.)
- **KTD-7 — Self-evolving hooks ship as documentation-only placeholders** with reserved `~/.claude/plugins/data/vibe-lingual/` paths (vibe-taker/vibe-walk pattern).

## Validation approach
Dogfood on Celestia3 (the cowpath app) at every command: `scan` reproduces the six-block brief with accurate counts + finds `SUPPORTED_LANGUAGES`/`outputLanguage`; `audit` flags `birthDateTime.ts` structural-Intl + the timeZone decision + RTL + dynamic-route glob; `localize` extracts one un-touched Celestia3 surface end-to-end with backup/rollback and tests green. The already-localized cowpath slice is the regression oracle (scan must NOT re-flag the 4 done surfaces).

## Next
`/checklist` — sequence this into a dependency-aware build plan (milestones).
