// Adapter STUB — wpf-resx. Declared, NOT implemented (M5 seam; WPF stack 2026-09-05).
//
// A WPF (.NET desktop) app localizes through .resx resources + CultureInfo — a
// different world from every JS adapter: the codemod rewrites XAML attributes to
// resource references, the parity guard compares .resx key sets across cultures,
// and the lint ratchet is a source-reading fence test, not an ESLint rule. The
// READ side (detect arm + XAML scanner) is real as of the WPF stack change; this
// stub exists so the registry can NAME the stack and report `not-yet-implemented`
// honestly for the MUTATING side, instead of letting the next-intl adapter near
// a .xaml file.
//
// matches() is INFORMATIONAL only: the registry maps any stub match to
// { adapter: null, status: 'not-yet-implemented' }. The mutating methods exist to
// satisfy the FrameworkAdapter shape and to throw loudly if ever called directly.

const NOT_IMPLEMENTED = "vibe-lingual: the wpf-resx adapter is declared but not yet implemented (scan/detect see WPF; extract/wire/guard do not, yet)";

function notImplemented() {
  throw new Error(NOT_IMPLEMENTED);
}

export const wpfResxStub = {
  id: 'wpf-resx',
  implemented: false,
  framework: 'wpf-resx',

  // Claims an app whose detected stack is WPF (csproj UseWPF / -windows TFM +
  // XAML surface). Informational — see header.
  matches(detection) {
    return !!(detection && detection.app && detection.app.stack === 'wpf');
  },

  wire: notImplemented,
  transform: notImplemented,
  emitParityTest: notImplemented,
  emitGuard: notImplemented,

  capabilities: { ssr: false, cookieLocale: false, dateFormatter: false, dualLocale: false },
};

export default wpfResxStub;
