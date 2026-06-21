// next-intl adapter — v1 deep adapter (App Router, cookie-driven locale).
//
// M7 SCOPE: the adapter is now FULLY implemented. `matches()` + `id` +
// `capabilities` (M5), wire() (M6), and the mutating core — transform /
// emitParityTest / emitGuard (M7) — are all real, modeled byte-for-byte on the
// proven Celestia3 cowpath:
//   - transform   → ./transform.mjs (jscodeshift codemod, server/client-aware,
//                   literal → t()/getTranslations/useFormatter, per-call tz)
//   - emitParityTest → ../../parity.mjs (recursive key-path parity test)
//   - emitGuard   → ./guard.mjs (jsx-no-literals override, '*'-globbed dynamic
//                   routes, eslint --print-config self-verify)
//
// What this adapter claims (the cowpath truth from Celestia3):
//   next-intl is the App-Router-native i18n choice. It claims any Next.js App
//   Router app — whether next-intl is ALREADY installed (existing partial setup)
//   or ABSENT (a greenfield retrofit where `localize` will install + wire it).
//   The discriminator is routerType === 'app', NOT whether the dep is present.
//   A Pages-Router app is claimed by the pages-router stub, not this adapter,
//   even if a next-intl dependency happens to be installed.

import { wire as wireNextIntl } from './wire.mjs';
import transformer, { transform as transformSource } from './transform.mjs';
import { emitGuard, verifyGuard } from './guard.mjs';
import { emitParityTest } from '../../parity.mjs';

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

  // The jscodeshift codemod: literal → t()/getTranslations/useFormatter,
  // server/client-aware, jsx-text + attribute kinds, per-call runtime timeZone on
  // date sites, structural-Intl left untouched, idempotent. This IS the
  // jscodeshift transform (fileInfo, api, options). A programmatic entry that
  // takes raw source is exposed as `transformSource` for the SKILL.
  transform: transformer,
  transformSource,

  // Emit the recursive key-path parity test for the given locales (delegates to
  // the framework-agnostic engine/parity.mjs — the test shape is identical across
  // frameworks; only the import path differs, which the SKILL supplies).
  emitParityTest(locales, options = {}) {
    return emitParityTest(locales, options);
  },

  // Emit the react/jsx-no-literals override for the fully-extracted files,
  // dynamic-route segments globbed with '*' (never the literal '[param]'), and
  // self-verify via `eslint --print-config` against the target app's eslint.
  emitGuard(files, options = {}) {
    return emitGuard(files, options);
  },

  // Self-verifying guard: emit + run `eslint --print-config` per file (degrades to
  // a structural verdict when eslint is not resolvable in the app).
  verifyGuard(files, options = {}) {
    return verifyGuard(files, options);
  },

  // Capabilities are real now (the SKILL reads these to gate prompts): next-intl
  // App Router supports SSR locale loading, cookie-driven locale (no /[locale]/
  // routing), a useFormatter date formatter, and a separate UI vs output locale.
  capabilities: { ssr: true, cookieLocale: true, dateFormatter: true, dualLocale: true },
};

export default nextIntlAdapter;
