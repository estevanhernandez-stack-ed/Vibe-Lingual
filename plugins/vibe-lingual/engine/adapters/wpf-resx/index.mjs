// wpf-resx adapter — the second implemented adapter behind the M5 seam
// (2026-09-06; the read side landed 2026-09-05, this is the mutating half).
//
// WPF localizes through compiled .resx catalogs, a public designer class the
// XAML addresses via {x:Static loc:Strings.Key}, per-culture satellite
// assemblies, and one culture-selection line at startup. The adapter maps the
// contract onto that world:
//   wire()          → resx template + culture-bootstrap snippet + csproj/startup
//                     patch descriptors + the manifest-honesty notes
//   transform       → transformXamlSource: span-precise XAML codemod off the
//                     scanner's own tokenizer (attrs + Setter values + sole-
//                     content text collapse; everything else STAGED, not guessed)
//   extractXaml     → the write-side driver (backup batch, idempotent resx
//                     merge, per-culture seeding) — the WPF analog of the JS
//                     extract loop, exposed for the CLI's stack dispatch
//   emitParityTest  → a C# xUnit resx key-parity fence for the target repo
//   emitGuard       → a C# xUnit display-literal ratchet for extracted files
//
// CONTRACT DEVIATION, DECLARED: `transform` is not a jscodeshift module — it is
// a (text, path, options) → result function, because the target language is
// XAML. The seam's promise is per-framework mutating machinery behind uniform
// method NAMES; the payload types follow the framework. adapter.contract.md
// gains this note in the same change.

import { wire } from './wire.mjs';
import transformXamlSource from './transform.mjs';
import { extractXaml } from './extract.mjs';
import { emitParityTest } from './parity.mjs';
import { emitGuard } from './guard.mjs';

export const wpfResxAdapter = {
  id: 'wpf-resx',
  implemented: true,
  framework: 'wpf-resx',

  // Claim: the detect arm said this is a WPF app. The stack signal is
  // definitive (csproj UseWPF / -windows TFM + XAML surface) — no dependency
  // inference involved. Pure predicate, no I/O.
  matches(detection) {
    return !!(detection && detection.app && detection.app.stack === 'wpf');
  },

  wire(ctx) {
    return wire(ctx);
  },

  // The XAML codemod (see contract-deviation note above).
  transform: transformXamlSource,
  transformSource: transformXamlSource,

  // The write-side driver the CLI dispatches to on stack 'wpf'.
  extractXaml,

  emitParityTest(locales, options = {}) {
    return emitParityTest(locales, options);
  },

  emitGuard(files, options = {}) {
    return emitGuard(files, options);
  },

  // No SSR, no cookie locale, no runtime date formatter switch (x:Static binds
  // once; culture applies at startup), and no dual-locale model out of the box.
  capabilities: { ssr: false, cookieLocale: false, dateFormatter: false, dualLocale: false },
};

export default wpfResxAdapter;
