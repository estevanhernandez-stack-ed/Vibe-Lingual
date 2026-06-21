// M6 — next-intl adapter wire() tests. The emitted WiredFileSet contains each
// file with the cowpath-proven content: request.ts with an AVAILABLE list + a
// try/catch source-fallback; locale-cookie.ts as the single cookie-name source;
// the layout NextIntlClientProvider mount; the next.config createNextIntlPlugin
// wiring; and the jest transformIgnorePatterns ESM allowlist. Reuse of a detected
// language list and separate UI-vs-output locale modeling are verified against
// the audit-app fixture (SUPPORTED_LANGUAGES + outputLanguage — the dual-locale
// cowpath shape).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detect } from '../engine/detect.mjs';
import { wire, ESM_ALLOWLIST } from '../engine/adapters/next-intl/wire.mjs';
import { nextIntlAdapter } from '../engine/adapters/next-intl/index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => join(__dirname, 'fixtures', name);

function findFile(set, suffix) {
  return set.files.find((f) => f.path.endsWith(suffix));
}
function findPatch(set, kind) {
  return set.patches.find((p) => p.kind === kind);
}

describe('wire() — emits the full file SET', () => {
  test('a greenfield App Router app gets request.ts + locale-cookie.ts created', () => {
    const set = wire({ detection: detect(fixture('app-router-no-intl')) });
    expect(findFile(set, 'i18n/request.ts')).toBeTruthy();
    expect(findFile(set, 'i18n/locale-cookie.ts')).toBeTruthy();
  });

  test('emits exactly the three config patches (provider mount, next.config, jest)', () => {
    const set = wire({ detection: detect(fixture('app-router-no-intl')) });
    const kinds = set.patches.map((p) => p.kind).sort();
    expect(kinds).toEqual(['jest-transform-ignore', 'next-config-plugin', 'next-intl-provider-mount']);
  });

  test('WiredFileSet shape: files[], patches[], notes[]', () => {
    const set = wire({ detection: detect(fixture('app-router-no-intl')) });
    expect(Array.isArray(set.files)).toBe(true);
    expect(Array.isArray(set.patches)).toBe(true);
    expect(Array.isArray(set.notes)).toBe(true);
    for (const f of set.files) {
      expect(typeof f.path).toBe('string');
      expect(typeof f.contents).toBe('string');
    }
  });

  test('the adapter.wire() entrypoint delegates to wire() (same output)', () => {
    const ctx = { detection: detect(fixture('app-router-no-intl')) };
    expect(nextIntlAdapter.wire(ctx)).toEqual(wire(ctx));
  });
});

describe('request.ts — AVAILABLE list + try/catch source-fallback', () => {
  test('contains an AVAILABLE list and the en source-fallback in the catch', () => {
    const set = wire({ detection: detect(fixture('app-router-no-intl')) });
    const req = findFile(set, 'request.ts').contents;
    // AVAILABLE rendered as a real array literal, source locale leads.
    expect(req).toMatch(/const AVAILABLE = \['en'/);
    // try/catch en-fallback present, byte-for-byte cowpath shape.
    expect(req).toContain('try {');
    expect(req).toContain('} catch {');
    expect(req).toMatch(/locale: 'en',/);
    expect(req).toContain("(await import(`../../messages/en.json`)).default");
    // gates resolution on the AVAILABLE membership check.
    expect(req).toContain('AVAILABLE.includes(requested)');
    // reads the cookie name from the single-source const, never a literal.
    expect(req).toContain("import { UI_LOCALE_COOKIE } from './locale-cookie'");
    expect(req).toContain('getRequestConfig');
  });

  test('AVAILABLE reflects the resolved locale set, source-first + de-duplicated', () => {
    const set = wire({
      detection: detect(fixture('app-router-no-intl')),
      locales: ['es', 'en', 'ja', 'es'], // unordered + dup en + dup es
    });
    const req = findFile(set, 'request.ts').contents;
    // en forced to front, dups removed, order otherwise stable.
    expect(req).toContain("const AVAILABLE = ['en', 'es', 'ja'];");
  });
});

describe('locale-cookie.ts — single-source cookie const + get/set helpers', () => {
  test('exports UI_LOCALE_COOKIE + getUiLocaleCookie + setUiLocaleCookie', () => {
    const set = wire({ detection: detect(fixture('app-router-no-intl')) });
    const cookie = findFile(set, 'locale-cookie.ts').contents;
    expect(cookie).toContain("export const UI_LOCALE_COOKIE = 'NEXT_LOCALE';");
    expect(cookie).toContain('export function getUiLocaleCookie(): string | null');
    expect(cookie).toContain('export function setUiLocaleCookie(code: string): void');
    // the cookie regexp is derived from the single-source const (no drift).
    expect(cookie).toContain("new RegExp('(?:^|;\\\\s*)' + UI_LOCALE_COOKIE + '=([^;]+)')");
  });

  test('honors a custom cookie name when provided', () => {
    const set = wire({ detection: detect(fixture('app-router-no-intl')), cookieName: 'UI_LANG' });
    expect(findFile(set, 'locale-cookie.ts').contents).toContain("export const UI_LOCALE_COOKIE = 'UI_LANG';");
  });
});

describe('provider mount — NextIntlClientProvider into the root layout', () => {
  test('patch targets the detected root layout and mounts the provider with no props', () => {
    const set = wire({ detection: detect(fixture('app-router-with-intl')) });
    const patch = findPatch(set, 'next-intl-provider-mount');
    expect(patch.file).toBe('src/app/layout.tsx');
    expect(patch.snippet).toContain('import { NextIntlClientProvider } from "next-intl";');
    expect(patch.snippet).toContain('<NextIntlClientProvider>');
    // no-props is the cowpath contract (locale + messages from request.ts).
    expect(patch.description).toContain('no props');
  });
});

describe('next.config — createNextIntlPlugin with the explicit request path', () => {
  test('wires the plugin with the explicit ./src/i18n/request.ts path', () => {
    const set = wire({ detection: detect(fixture('app-router-with-intl')) });
    const patch = findPatch(set, 'next-config-plugin');
    expect(patch.snippet).toContain('import createNextIntlPlugin from "next-intl/plugin";');
    expect(patch.snippet).toContain('createNextIntlPlugin("./src/i18n/request.ts")');
    expect(patch.snippet).toContain('const withNextIntl =');
  });
});

describe('jest patch — the transformIgnorePatterns ESM allowlist is injected', () => {
  test('patch carries the ESM allowlist + the async-wrapper replace shape', () => {
    const set = wire({ detection: detect(fixture('app-router-no-intl')) });
    const patch = findPatch(set, 'jest-transform-ignore');
    expect(patch.allowlist).toEqual(['next-intl', 'use-intl', 'intl-messageformat', '@formatjs']);
    // the load-bearing replace string (byte-for-byte cowpath shape).
    expect(patch.snippet).toContain("p.replace('(?!(', '(?!(next-intl|use-intl|intl-messageformat|@formatjs|')");
    // the async wrapper that post-processes the resolved next/jest config.
    expect(patch.snippet).toContain('module.exports = async () => {');
    expect(patch.snippet).toContain('await jestConfigFn()');
  });

  test('the exported ESM_ALLOWLIST is the four ESM-only i18n packages', () => {
    expect(ESM_ALLOWLIST).toEqual(['next-intl', 'use-intl', 'intl-messageformat', '@formatjs']);
  });
});

describe('reuse — an existing language list drives the UI locale set', () => {
  // audit-app carries SUPPORTED_LANGUAGES (10 locales) + an outputLanguage pref —
  // the dual-locale cowpath shape. The SKILL extracts the codes off the detected
  // list symbol and passes them as existingLanguageList.codes.
  const detection = detect(fixture('audit-app'));
  const codes = ['en', 'es', 'ja', 'ar', 'he', 'ur', 'fr', 'de', 'pt', 'zh'];

  test('reuses the detected SUPPORTED_LANGUAGES codes for AVAILABLE (no parallel list)', () => {
    const set = wire({
      detection,
      existingLanguageList: { file: 'src/lib/languages.ts', symbol: 'SUPPORTED_LANGUAGES', codes },
    });
    const req = findFile(set, 'request.ts').contents;
    expect(req).toContain(
      "const AVAILABLE = ['en', 'es', 'ja', 'ar', 'he', 'ur', 'fr', 'de', 'pt', 'zh'];",
    );
    // a reuse note names the symbol it pulled from.
    expect(set.notes.some((n) => n.includes('SUPPORTED_LANGUAGES'))).toBe(true);
  });

  test('models UI locale SEPARATELY from the output locale (dual-locale note)', () => {
    const set = wire({
      detection,
      existingLanguageList: { file: 'src/lib/languages.ts', symbol: 'SUPPORTED_LANGUAGES', codes },
    });
    const dualNote = set.notes.find((n) => n.includes('Dual-locale'));
    expect(dualNote).toBeTruthy();
    // names the detected output-locale symbol it must NOT move in lockstep with.
    expect(dualNote).toContain('outputLanguage');
    expect(dualNote).toContain('NEXT_LOCALE');
  });

  test('reuse also works via detection.existingI18n.languageList.codes', () => {
    const det = detect(fixture('audit-app'));
    det.existingI18n.languageList.codes = codes; // mirror the SKILL enriching the symbol with codes
    const set = wire({ detection: det });
    expect(findFile(set, 'request.ts').contents).toContain(
      "const AVAILABLE = ['en', 'es', 'ja', 'ar', 'he', 'ur', 'fr', 'de', 'pt', 'zh'];",
    );
  });
});

describe('wiring notes — cowpath gotchas surfaced', () => {
  test('always documents the one-render cookie lag and the AVAILABLE-grows contract', () => {
    const set = wire({ detection: detect(fixture('app-router-no-intl')) });
    expect(set.notes.some((n) => n.includes('One-render cookie lag'))).toBe(true);
    expect(set.notes.some((n) => /AVAILABLE.*advisory.*grows/s.test(n))).toBe(true);
  });

  test('a truly bare app (no language list + no pref) emits no reuse/dual-locale note', () => {
    // synthetic: App Router, no existing-i18n map at all.
    const det = {
      app: { root: '/tmp/bare', framework: 'none', routerType: 'app', turbopack: false, ssrFiles: ['src/app/layout.tsx'] },
      existingI18n: { lib: null, languageList: null, localePref: null },
    };
    const set = wire({ detection: det });
    expect(set.notes.some((n) => n.includes('Dual-locale'))).toBe(false);
    expect(set.notes.some((n) => n.includes('Reused the app'))).toBe(false);
  });
});

describe('src-dir convention — i18n path follows the app layout', () => {
  test('an app with src/ ssrFiles writes under src/i18n and imports ../../messages', () => {
    const set = wire({ detection: detect(fixture('app-router-with-intl')) });
    expect(findFile(set, 'request.ts').path).toBe('src/i18n/request.ts');
    expect(findFile(set, 'request.ts').contents).toContain('../../messages/');
  });

  test('an app with no src/ layout writes under app-root i18n and imports ../messages', () => {
    // synthetic detection: App Router at the repo root (no src/ prefix on ssrFiles).
    const det = {
      app: { root: '/tmp/rootapp', framework: 'none', routerType: 'app', turbopack: false, ssrFiles: ['app/layout.tsx'] },
      existingI18n: { lib: null, languageList: null, localePref: null },
    };
    const set = wire({ detection: det });
    expect(findFile(set, 'request.ts').path).toBe('i18n/request.ts');
    expect(findFile(set, 'request.ts').contents).toContain('../messages/');
    expect(findPatch(set, 'next-intl-provider-mount').file).toBe('app/layout.tsx');
  });
});

describe('purity + robustness', () => {
  test('wire({}) degrades to greenfield defaults, never throws', () => {
    const set = wire({});
    expect(findFile(set, 'request.ts')).toBeTruthy();
    expect(findFile(set, 'request.ts').contents).toContain("const AVAILABLE = ['en'];");
  });

  test('wire() with no args degrades to greenfield defaults, never throws', () => {
    expect(() => wire()).not.toThrow();
  });
});
