# The FrameworkAdapter contract (the seam)

> This is the seam vibe-lingual is built around. The engine (detect → scan → audit)
> is framework-agnostic: it finds user-facing strings and i18n-retrofit gotchas in
> any React/Next app. The *mutating* work — wiring a framework, rewriting literals
> into translation calls, emitting a parity test and a lint guard — is framework-
> specific, and that work lives behind this interface. v1 implements exactly one
> adapter deep (next-intl, App Router). Every other framework is a declared stub
> that resolves cleanly to `not-yet-implemented` rather than mis-handling an app.
>
> KTD-3: the seam is real from v1, but only next-intl is implemented. A non-match
> never crashes and never mutates — it reports honestly so `localize` can refuse.

## Why a seam and not a switch

The cowpath (Celestia3, next-intl + App Router) proved the *shape* of the work. The
shape generalizes — every framework needs a request/locale loader, a literal→call
codemod, a catalog parity guard, a lint ratchet — but the *templates* do not. A
`react-i18next` app wires `i18n.ts` + `I18nextProvider`, not `request.ts` +
`NextIntlClientProvider`. A `vue-i18n` app is a different language entirely. Putting
each framework behind a uniform interface keeps `localize` from growing a per-
framework `if` ladder, and lets the family add adapters one at a time without
touching the engine.

## The interface

```ts
interface FrameworkAdapter {
  // ---- identity ----------------------------------------------------------
  id: string;                    // stable slug, e.g. 'next-intl'

  // ---- claim ------------------------------------------------------------
  // Does this adapter handle the detected app? Pure predicate over the M1
  // detection result ({ app, existingI18n }). No I/O, no mutation. The first
  // registered adapter whose matches() returns true wins (registry order is
  // the precedence; next-intl is registered first).
  matches(detection): boolean;

  // ---- the mutating surface (only the matched adapter is ever called) ----
  // Emit the framework wiring: request/config loader (with an AVAILABLE-catalog
  // list + try/catch en-fallback), locale-cookie helper, provider mount snippet,
  // the jest transformIgnorePatterns ESM patch, and the next.config plugin wiring.
  // Returns a WiredFileSet (paths + contents + patch descriptors). Pure plan —
  // the SKILL decides whether to write, per confidence routing.
  wire(ctx): WiredFileSet;

  // A jscodeshift transform: literal → t() / getTranslations / useFormatter,
  // server/client-aware, covering jsx-text + attribute kinds. Provided as a
  // transform module reference (the codemod), not invoked here.
  transform: jscodeshiftTransform;

  // Emit a recursive key-path catalog parity test for the given locales — the
  // single highest-value reusable guard (catches BOTH missing and extra keys).
  emitParityTest(locales: string[]): File;

  // Emit the eslint guard override (react/jsx-no-literals) for the fully-extracted
  // files. Dynamic-route segments are globbed with '*' (NEVER the literal
  // '[param]' — minimatch treats it as a char class and silently never matches),
  // and each guarded file is self-verified via `eslint --print-config`.
  emitGuard(files: string[]): EslintOverride;

  // ---- capability advertisement -----------------------------------------
  // What this adapter's framework can express. Lets the SKILL skip prompts a
  // framework can't honor (e.g. no cookie-locale → no cookie-sync wiring).
  capabilities: {
    ssr: boolean;            // server-side locale loading supported
    cookieLocale: boolean;   // cookie-driven (no /[locale]/ URL routing)
    dateFormatter: boolean;  // a useFormatter-equivalent for Intl dates
    dualLocale: boolean;     // can model uiLanguage separately from outputLanguage
  };
}
```

## Helper shapes

```ts
// A single emitted file plan. The SKILL writes it (confidence-routed + backed up).
interface File { path: string; contents: string; }

// wire()'s return: files to create + patches to apply to existing config.
interface WiredFileSet {
  files: File[];                 // new files (request.ts, locale-cookie.ts, ...)
  patches: PatchDescriptor[];    // edits to jest.config / next.config / eslint.config
  notes: string[];              // human-facing wiring notes (e.g. the one-render cookie lag)
}

interface PatchDescriptor {
  file: string;                  // the config file to patch
  kind: string;                  // 'jest-transform-ignore' | 'next-config-plugin' | ...
  description: string;
}

// emitGuard()'s return: an eslint flat-config override block (glob-safe).
interface EslintOverride {
  files: string[];               // glob patterns, dynamic-route dirs as '*'
  rules: Record<string, unknown>;// e.g. { 'react/jsx-no-literals': 'error' }
}
```

## The `ctx` passed to `wire()`

`wire(ctx)` receives the detection + inventory context it needs to reuse what the
app already has rather than generating a parallel world:

```ts
interface WireContext {
  detection;                     // M1 detect() output ({ app, existingI18n })
  inventory;                     // M2 scan() output (sites, countsByKind, ...)
  locales: string[];             // target locales (defaults to existingI18n list if present)
  existingLanguageList?: { file: string; symbol: string };  // reuse SUPPORTED_LANGUAGES
}
```

## Registry contract (`index.mjs`)

```
resolveAdapter(detection) ->
  { adapter, status: 'ready',               framework }   // a match (v1: next-intl only)
  { adapter: null, status: 'not-yet-implemented', framework }  // no implemented match
```

- Registration order is precedence. v1 registers next-intl first; the `_stubs/`
  entries (react-i18next, pages-router, vue-i18n) are declared so the registry can
  *name* the framework it can't yet handle, but they never return an implemented
  adapter — their `matches()` is informational, and the registry maps any stub
  match (or no match at all) to `{ adapter: null, status: 'not-yet-implemented' }`.
- `framework` on the result is the detected framework string (or a stub's declared
  framework when a stub claims the app), so `localize` can tell the user exactly
  what it found and why it's standing down.
- The registry never mutates and never throws on an unknown framework. A missing /
  malformed detection degrades to `{ adapter: null, status: 'not-yet-implemented',
  framework: 'unknown' }`.

## Adding an adapter (the future path)

1. Implement the interface under `adapters/<id>/` (mirror `adapters/next-intl/`).
2. Replace the `_stubs/<id>.mjs` declaration with a real `matches()` + the mutating
   methods.
3. Register it in `index.mjs` (order = precedence).
4. Add a fixture app + extend `tests/adapters.test.mjs`.

Until then, the stub keeps the promise honest: vibe-lingual will tell you it sees a
`react-i18next` app and that it can't localize it yet — it will not pretend.
