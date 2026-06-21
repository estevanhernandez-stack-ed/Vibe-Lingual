// vibe-lingual adapter registry — detect → dispatch (M5, the seam).
//
// Pure resolution. Given the M1 detection result ({ app, existingI18n }), pick the
// FrameworkAdapter that handles this app. v1 registers exactly ONE implemented
// adapter — next-intl (App Router) — plus three declared stubs (react-i18next,
// pages-router, vue-i18n) that let the registry NAME a framework it can't yet
// handle and stand down honestly.
//
// KTD-3: the seam is real from v1, but only next-intl is implemented. A non-match
// returns { adapter: null, status: 'not-yet-implemented', framework } — never a
// crash, never a mutation. See adapter.contract.md for the full interface.

import { nextIntlAdapter } from './next-intl/index.mjs';
import { reactI18nextStub } from './_stubs/react-i18next.mjs';
import { pagesRouterStub } from './_stubs/pages-router.mjs';
import { vueI18nStub } from './_stubs/vue-i18n.mjs';

// Registration order IS precedence. The implemented adapter is checked first so it
// wins on any app it claims; the stubs follow only to label the framework for the
// not-yet-implemented report. The pages-router stub precedes react-i18next so a
// Pages-Router app is named by its router (the disqualifier) rather than by an
// installed react-i18next dep.
const IMPLEMENTED_ADAPTERS = [nextIntlAdapter];
const STUB_ADAPTERS = [pagesRouterStub, reactI18nextStub, vueI18nStub];

// The full ordered roster (implemented first). Exposed for introspection/tests.
export const REGISTERED_ADAPTERS = [...IMPLEMENTED_ADAPTERS, ...STUB_ADAPTERS];

function detectedFramework(detection) {
  const fw = detection && detection.app && detection.app.framework;
  return typeof fw === 'string' && fw.length > 0 ? fw : 'unknown';
}

// Resolve the adapter for a detected app.
//   match on an implemented adapter  → { adapter, status: 'ready', framework }
//   no implemented match             → { adapter: null, status: 'not-yet-implemented', framework }
// `framework` is the most specific label available: a matching stub's declared
// framework (e.g. 'pages-router', 'vue-i18n') when one claims the app, otherwise
// the detected framework string. Never throws; a missing/malformed detection
// degrades to not-yet-implemented / 'unknown'.
export function resolveAdapter(detection) {
  // 1. An implemented adapter wins outright.
  for (const adapter of IMPLEMENTED_ADAPTERS) {
    let claimed = false;
    try {
      claimed = adapter.matches(detection) === true;
    } catch {
      claimed = false; // a predicate throw is treated as no-match, never propagated
    }
    if (claimed) {
      return { adapter, status: 'ready', framework: adapter.framework };
    }
  }

  // 2. No implemented match. Find the most specific stub label to report, so the
  //    not-yet-implemented message can name exactly what we saw.
  let stubFramework = null;
  for (const stub of STUB_ADAPTERS) {
    let claimed = false;
    try {
      claimed = stub.matches(detection) === true;
    } catch {
      claimed = false;
    }
    if (claimed) {
      stubFramework = stub.framework;
      break; // first stub (in precedence order) labels the report
    }
  }

  return {
    adapter: null,
    status: 'not-yet-implemented',
    framework: stubFramework || detectedFramework(detection),
  };
}

export default resolveAdapter;
