// M5 — adapter seam tests. The registry resolves the next-intl adapter for an
// App-Router + React app, and reports a clean not-yet-implemented for every
// framework that lacks an implemented adapter — no crash, no mutation.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detect } from '../engine/detect.mjs';
import {
  resolveAdapter,
  REGISTERED_ADAPTERS,
} from '../engine/adapters/index.mjs';
import { nextIntlAdapter } from '../engine/adapters/next-intl/index.mjs';
import { reactI18nextStub } from '../engine/adapters/_stubs/react-i18next.mjs';
import { pagesRouterStub } from '../engine/adapters/_stubs/pages-router.mjs';
import { vueI18nStub } from '../engine/adapters/_stubs/vue-i18n.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(__dirname, 'fixtures', name);

// Synthetic detection helper for frameworks the React/Next detector can't surface
// on its own (Vue). Mirrors the M1 detect() shape exactly.
function detection({ framework = 'none', routerType = 'app', ...rest } = {}) {
  return {
    app: { root: '/tmp/app', framework, routerType, turbopack: false, ssrFiles: [], ...rest },
    existingI18n: { lib: null, languageList: null, localePref: null },
  };
}

describe('registry — resolves next-intl for a matching app', () => {
  test('App Router + next-intl PRESENT → next-intl adapter, status ready', () => {
    const result = resolveAdapter(detect(fixture('app-router-with-intl')));
    expect(result.adapter).toBe(nextIntlAdapter);
    expect(result.adapter.id).toBe('next-intl');
    expect(result.status).toBe('ready');
    expect(result.framework).toBe('next-intl');
  });

  test('App Router + react, next-intl ABSENT (framework none) → next-intl adapter (greenfield retrofit)', () => {
    // The cowpath truth: next-intl claims any App Router app, installed or not.
    // framework 'none' + routerType 'app' is exactly the Celestia3 pre-retrofit
    // shape — the registry must hand back the next-intl adapter so localize can
    // install + wire it, NOT report not-yet-implemented.
    const result = resolveAdapter(detect(fixture('app-router-no-intl')));
    expect(result.adapter).toBe(nextIntlAdapter);
    expect(result.status).toBe('ready');
    expect(result.framework).toBe('next-intl');
  });

  test('the resolved adapter advertises real next-intl capabilities', () => {
    const { adapter } = resolveAdapter(detect(fixture('app-router-with-intl')));
    expect(adapter.capabilities).toEqual({
      ssr: true,
      cookieLocale: true,
      dateFormatter: true,
      dualLocale: true,
    });
  });
});

describe('registry — not-yet-implemented for unimplemented frameworks', () => {
  test('Pages Router → not-yet-implemented, labeled pages-router, adapter null', () => {
    const result = resolveAdapter(detect(fixture('pages-router')));
    expect(result.adapter).toBeNull();
    expect(result.status).toBe('not-yet-implemented');
    // The router type is the disqualifier — reported as 'pages-router', not 'none'.
    expect(result.framework).toBe('pages-router');
  });

  test('react-i18next app → not-yet-implemented, labeled react-i18next, adapter null', () => {
    const result = resolveAdapter(detection({ framework: 'react-i18next', routerType: 'app' }));
    expect(result.adapter).toBeNull();
    expect(result.status).toBe('not-yet-implemented');
    expect(result.framework).toBe('react-i18next');
  });

  test('i18next app → not-yet-implemented (claimed by the react-i18next stub)', () => {
    const result = resolveAdapter(detection({ framework: 'i18next', routerType: 'app' }));
    expect(result.adapter).toBeNull();
    expect(result.status).toBe('not-yet-implemented');
    expect(result.framework).toBe('react-i18next');
  });

  test('Vue / vue-i18n app → not-yet-implemented, labeled vue-i18n, adapter null', () => {
    const result = resolveAdapter(detection({ framework: 'vue-i18n', routerType: 'unknown' }));
    expect(result.adapter).toBeNull();
    expect(result.status).toBe('not-yet-implemented');
    expect(result.framework).toBe('vue-i18n');
  });

  test('a Pages-Router app with next-intl installed is still NOT claimed by next-intl', () => {
    // routerType is the discriminator: an installed next-intl dep does not let the
    // App-Router adapter claim a Pages-Router tree.
    const result = resolveAdapter(detection({ framework: 'next-intl', routerType: 'pages' }));
    expect(result.adapter).toBeNull();
    expect(result.status).toBe('not-yet-implemented');
    expect(result.framework).toBe('pages-router');
  });
});

describe('registry — robustness (no crash, degrades cleanly)', () => {
  test('null detection → not-yet-implemented, framework unknown, no throw', () => {
    const result = resolveAdapter(null);
    expect(result.adapter).toBeNull();
    expect(result.status).toBe('not-yet-implemented');
    expect(result.framework).toBe('unknown');
  });

  test('empty object detection → not-yet-implemented, framework unknown', () => {
    const result = resolveAdapter({});
    expect(result.adapter).toBeNull();
    expect(result.framework).toBe('unknown');
  });

  test('a framework with no stub label falls back to the detected framework string', () => {
    // lingui has no dedicated stub; with an App Router it is not claimed by
    // next-intl (different framework) and not by any stub → reported as 'lingui'.
    const result = resolveAdapter(detection({ framework: 'lingui', routerType: 'app' }));
    expect(result.adapter).toBeNull();
    expect(result.status).toBe('not-yet-implemented');
    expect(result.framework).toBe('lingui');
  });

  test('resolution result always carries exactly adapter/status/framework keys', () => {
    const result = resolveAdapter(detect(fixture('app-router-with-intl')));
    expect(Object.keys(result).sort()).toEqual(['adapter', 'framework', 'status']);
  });
});

describe('registry — roster + precedence', () => {
  test('exactly four adapters registered, next-intl first', () => {
    expect(REGISTERED_ADAPTERS.map((a) => a.id)).toEqual([
      'next-intl',
      'pages-router',
      'react-i18next',
      'vue-i18n',
    ]);
  });

  test('only next-intl is marked implemented; the three stubs are not', () => {
    const implemented = REGISTERED_ADAPTERS.filter((a) => a.implemented).map((a) => a.id);
    expect(implemented).toEqual(['next-intl']);
  });
});

describe('stubs — declared but inert (no mutation surface)', () => {
  const cases = [
    ['react-i18next', reactI18nextStub],
    ['pages-router', pagesRouterStub],
    ['vue-i18n', vueI18nStub],
  ];

  test.each(cases)('%s stub: every mutating method throws not-implemented', (_id, stub) => {
    expect(() => stub.wire({})).toThrow(/not yet implemented/i);
    expect(() => stub.transform({})).toThrow(/not yet implemented/i);
    expect(() => stub.emitParityTest(['en'])).toThrow(/not yet implemented/i);
    expect(() => stub.emitGuard([])).toThrow(/not yet implemented/i);
  });

  test.each(cases)('%s stub: matches() is a pure predicate that never throws', (_id, stub) => {
    expect(() => stub.matches(null)).not.toThrow();
    expect(() => stub.matches({})).not.toThrow();
    expect(typeof stub.matches(detection())).toBe('boolean');
  });
});

describe('next-intl adapter — mutating methods are TODO (M6/M7), throw if called early', () => {
  test('wire() throws the M6 marker', () => {
    expect(() => nextIntlAdapter.wire({})).toThrow(/M6/);
  });

  test('transform / emitParityTest / emitGuard throw the M7 marker', () => {
    expect(() => nextIntlAdapter.transform({})).toThrow(/M7/);
    expect(() => nextIntlAdapter.emitParityTest(['en'])).toThrow(/M7/);
    expect(() => nextIntlAdapter.emitGuard([])).toThrow(/M7/);
  });

  test('matches() is a pure predicate — true for App Router, false for Pages', () => {
    expect(nextIntlAdapter.matches(detection({ routerType: 'app', framework: 'none' }))).toBe(true);
    expect(nextIntlAdapter.matches(detection({ routerType: 'pages', framework: 'next-intl' }))).toBe(false);
    expect(() => nextIntlAdapter.matches(null)).not.toThrow();
  });
});
