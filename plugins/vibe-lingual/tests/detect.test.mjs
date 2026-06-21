// M1 — detection engine tests. Real assertions on every field of the
// inventory "app" + "existingI18n" shapes, across three tiny app trees.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detect } from '../engine/detect.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(__dirname, 'fixtures', name);

describe('detect — (a) App Router, next-intl ABSENT, SUPPORTED_LANGUAGES present', () => {
  const result = detect(fixture('app-router-no-intl'));

  test('framework is none (no i18n dep installed)', () => {
    expect(result.app.framework).toBe('none');
  });

  test('router type is app', () => {
    expect(result.app.routerType).toBe('app');
  });

  test('Turbopack detected via --turbo dev-script flag', () => {
    expect(result.app.turbopack).toBe(true);
  });

  test('SSR files found under src/app (page + layout)', () => {
    expect(result.app.ssrFiles).toEqual(['src/app/layout.tsx', 'src/app/page.tsx']);
  });

  test('existingI18n.lib is null (no i18n framework)', () => {
    expect(result.existingI18n.lib).toBeNull();
  });

  test('finds the SUPPORTED_LANGUAGES language list with file + symbol', () => {
    expect(result.existingI18n.languageList).toEqual({
      file: 'src/lib/languages.ts',
      symbol: 'SUPPORTED_LANGUAGES',
    });
  });

  test('finds an outputLanguage-shaped locale pref at the canonical declaration site', () => {
    expect(result.existingI18n.localePref).not.toBeNull();
    expect(result.existingI18n.localePref.symbol).toBe('outputLanguage');
    // Two genuine declarations exist: a `let outputLanguage = 'en'` binding in
    // src/lib/languages.ts (mutable runtime holder) and an `outputLanguage?:`
    // field in the UserPreferences interface in src/types/preferences.ts (the
    // type contract). Resolution is NOT walk-order; it scores candidates and
    // keeps the strongest. The UserPreferences field wins on the pref-interface
    // tier + types/ path bonus — the canonical home for the locale preference,
    // which matches how the real Celestia3 reference is shaped. The pick is
    // deterministic and intentional, not an accident of directory sort order.
    expect(result.existingI18n.localePref.file).toBe('src/types/preferences.ts');
  });

  test('root is echoed back on the app object', () => {
    expect(result.app.root).toBe(fixture('app-router-no-intl'));
  });
});

describe('detect — (b) App Router, next-intl PRESENT', () => {
  const result = detect(fixture('app-router-with-intl'));

  test('framework is next-intl', () => {
    expect(result.app.framework).toBe('next-intl');
  });

  test('router type is app', () => {
    expect(result.app.routerType).toBe('app');
  });

  test('Turbopack detected via next.config turbopack key', () => {
    expect(result.app.turbopack).toBe(true);
  });

  test('SSR files include the [shareId] dynamic route, sorted POSIX-relative', () => {
    expect(result.app.ssrFiles).toEqual([
      'src/app/layout.tsx',
      'src/app/page.tsx',
      'src/app/s/[shareId]/page.tsx',
    ]);
  });

  test('existingI18n.lib mirrors the detected framework', () => {
    expect(result.existingI18n.lib).toBe('next-intl');
  });

  test('no SUPPORTED_LANGUAGES list present → languageList is null', () => {
    expect(result.existingI18n.languageList).toBeNull();
  });

  test('no outputLanguage pref present → localePref is null', () => {
    expect(result.existingI18n.localePref).toBeNull();
  });
});

describe('detect — (c) Pages Router', () => {
  const result = detect(fixture('pages-router'));

  test('framework is none', () => {
    expect(result.app.framework).toBe('none');
  });

  test('router type is pages', () => {
    expect(result.app.routerType).toBe('pages');
  });

  test('Turbopack absent (plain next dev, no config key)', () => {
    expect(result.app.turbopack).toBe(false);
  });

  test('no App Router → ssrFiles is empty (pages-router not walked for page/layout)', () => {
    expect(result.app.ssrFiles).toEqual([]);
  });

  test('existingI18n map is empty (no lib, no list, no pref)', () => {
    expect(result.existingI18n).toEqual({
      lib: null,
      languageList: null,
      localePref: null,
    });
  });
});

describe('detect — (d) locale pref: usage site BEFORE declaration in walk order', () => {
  // Regression guard for the M1 detection bug. A JSX-prop usage + an object
  // property (`uiLanguage={…}`, `{ uiLanguage: code }`) live in
  // src/components/Calibration.tsx, which walks BEFORE the real declaration in
  // src/types/preferences.ts (components/ sorts ahead of types/). The old
  // LOCALE_PREF_RE made the const|let|var keyword optional and matched any
  // `symbol [?:=]`, so it stopped at the first usage site and reported a
  // component file as the source of truth — the exact Celestia3 dogfood failure
  // (CosmicCalibration.tsx:416 instead of src/types/preferences.ts). The engine
  // must skip both usage sites and resolve to the declaration.
  const result = detect(fixture('app-router-pref-usage-before-decl'));

  test('resolves to the declaration file, not the earlier usage component', () => {
    expect(result.existingI18n.localePref).not.toBeNull();
    expect(result.existingI18n.localePref.file).toBe('src/types/preferences.ts');
  });

  test('the resolved symbol is an output-language-shaped pref', () => {
    expect(['outputLanguage', 'uiLanguage']).toContain(
      result.existingI18n.localePref.symbol,
    );
  });

  test('does NOT report the usage component (components/Calibration.tsx)', () => {
    expect(result.existingI18n.localePref.file).not.toBe('src/components/Calibration.tsx');
  });
});

describe('detect — (e) locale pref: component PROPS-INTERFACE field BEFORE the real declaration', () => {
  // Regression guard for the live Celestia3 defect the (d) fixture missed.
  // (d) only modeled JSX-attr + object-property USAGES — shapes the regex
  // already rejected on form alone. This fixture models the shape that actually
  // broke on the real app: an earlier-walking component file
  // (src/components/settings/LanguageSettings.tsx) declares a *Props-interface
  // field `uiLanguage: string;` — form (3) `<symbol>: <type>;`, identical in
  // shape to the real declaration, so the bare LOCALE_PREF_RE matches it. Because
  // src/components/ walks before src/types/, the wrong file won (the engine
  // returned LanguageSettings.tsx:9 instead of src/types/preferences.ts, exactly
  // mirroring the cowpath's CosmicCalibration.tsx:416-vs-preferences.ts:73
  // failure). The detector must reject the *Props field (component prop wiring,
  // not the app pref) and resolve to the UserPreferences declaration.
  const result = detect(fixture('app-router-props-iface-before-decl'));

  test('resolves to the real UserPreferences declaration, not the props interface', () => {
    expect(result.existingI18n.localePref).not.toBeNull();
    expect(result.existingI18n.localePref.file).toBe('src/types/preferences.ts');
  });

  test('does NOT report the component props interface file', () => {
    expect(result.existingI18n.localePref.file).not.toBe(
      'src/components/settings/LanguageSettings.tsx',
    );
  });

  test('the resolved symbol is an output-language-shaped pref', () => {
    expect(['outputLanguage', 'uiLanguage']).toContain(
      result.existingI18n.localePref.symbol,
    );
  });
});

describe('detect — robustness', () => {
  test('a non-existent root degrades to none/unknown without throwing', () => {
    const result = detect(join(__dirname, 'fixtures', '__does_not_exist__'));
    expect(result.app.framework).toBe('none');
    expect(result.app.routerType).toBe('unknown');
    expect(result.app.turbopack).toBe(false);
    expect(result.app.ssrFiles).toEqual([]);
    expect(result.existingI18n).toEqual({ lib: null, languageList: null, localePref: null });
  });

  test('the returned shape carries exactly the inventory app + existingI18n keys', () => {
    const result = detect(fixture('app-router-with-intl'));
    expect(Object.keys(result).sort()).toEqual(['app', 'existingI18n']);
    expect(Object.keys(result.app).sort()).toEqual([
      'framework',
      'root',
      'routerType',
      'ssrFiles',
      'turbopack',
    ]);
    expect(Object.keys(result.existingI18n).sort()).toEqual([
      'languageList',
      'lib',
      'localePref',
    ]);
  });
});
