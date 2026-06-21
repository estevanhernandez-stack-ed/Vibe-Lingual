// next-intl adapter — v1 deep adapter (App Router, cookie-driven locale).
//
// M6 SCOPE: `matches()` + `id` + `capabilities` are real (M5), and wire() is now
// the deep, cowpath-modeled implementation (delegated to ./wire.mjs). The
// remaining mutating methods — transform / emitParityTest / emitGuard (M7) — are
// clearly-marked TODO and MUST NOT be implemented here. They throw a marked
// "not yet implemented" error if called before M7 lands, so an accidental early
// call fails loudly instead of silently no-op'ing.
//
// What this adapter claims (the cowpath truth from Celestia3):
//   next-intl is the App-Router-native i18n choice. It claims any Next.js App
//   Router app — whether next-intl is ALREADY installed (existing partial setup)
//   or ABSENT (a greenfield retrofit where `localize` will install + wire it).
//   The discriminator is routerType === 'app', NOT whether the dep is present.
//   A Pages-Router app is claimed by the pages-router stub, not this adapter,
//   even if a next-intl dependency happens to be installed.

import { wire as wireNextIntl } from './wire.mjs';

const TODO_M7 = "vibe-lingual: next-intl transform lands in M7 — not yet implemented";

// A frameworks-this-adapter-can-claim set: next-intl proper, or 'none' (no i18n
// lib yet) — both are valid when the router is App Router. A DIFFERENT installed
// i18n framework (react-i18next/i18next/react-intl/lingui) is NOT claimed here;
// those belong to their own (stubbed) adapters.
const CLAIMABLE_FRAMEWORKS = new Set(['next-intl', 'none']);

export const nextIntlAdapter = {
  id: 'next-intl',
  implemented: true, // the seam is real; deep methods land in M6/M7
  framework: 'next-intl',

  // Claim: App Router + (next-intl already present OR no i18n lib yet). Pure
  // predicate over the M1 detection result. No I/O, no mutation.
  matches(detection) {
    const app = (detection && detection.app) || {};
    if (app.routerType !== 'app') return false;
    return CLAIMABLE_FRAMEWORKS.has(app.framework);
  },

  // ---- mutating surface ---------------------------------------------------
  // wire() (M6) is implemented: emits request.ts (AVAILABLE-list + try/catch
  // source-fallback), locale-cookie.ts, the layout provider-mount patch, the
  // next.config plugin wiring patch, and the jest transformIgnorePatterns ESM
  // allowlist patch — all modeled byte-for-byte on the Celestia3 cowpath. Pure
  // plan: returns a WiredFileSet; the SKILL writes it per confidence routing.
  wire(ctx) {
    return wireNextIntl(ctx);
  },

  // TODO(M7): jscodeshift codemod literal → t()/getTranslations/useFormatter,
  // server/client-aware, attribute kinds too. A function placeholder for now so
  // the `transform` property is the right TYPE (a callable transform module).
  transform(/* fileInfo, api, options */) {
    throw new Error(TODO_M7);
  },

  // TODO(M7): emit the recursive key-path parity test for the given locales.
  emitParityTest(/* locales */) {
    throw new Error(TODO_M7);
  },

  // TODO(M7): emit the react/jsx-no-literals override, dynamic routes globbed
  // with '*', self-verified via `eslint --print-config`.
  emitGuard(/* files */) {
    throw new Error(TODO_M7);
  },

  // Capabilities are real now (the SKILL reads these to gate prompts): next-intl
  // App Router supports SSR locale loading, cookie-driven locale (no /[locale]/
  // routing), a useFormatter date formatter, and a separate UI vs output locale.
  capabilities: { ssr: true, cookieLocale: true, dateFormatter: true, dualLocale: true },
};

export default nextIntlAdapter;
