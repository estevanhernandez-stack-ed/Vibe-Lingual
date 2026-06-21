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

  test('finds an outputLanguage-shaped locale pref with file + symbol', () => {
    expect(result.existingI18n.localePref).not.toBeNull();
    expect(result.existingI18n.localePref.symbol).toBe('outputLanguage');
    // First declaration site wins; both languages.ts and types/preferences.ts declare it.
    expect(['src/lib/languages.ts', 'src/types/preferences.ts']).toContain(
      result.existingI18n.localePref.file,
    );
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
