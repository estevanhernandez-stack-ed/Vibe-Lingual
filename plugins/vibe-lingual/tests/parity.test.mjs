// M7 — catalog parity tests. The recursive key-path guard catches BOTH a MISSING
// key (a locale forgot one) AND an EXTRA key (a locale grew a stray one) — a flat
// top-level diff misses nested drift, so verifyParity walks every leaf path. The
// emitter renders the cowpath-proven test source.

import { keyPaths, verifyParity, emitParityTest } from '../engine/parity.mjs';

describe('keyPaths — recursive leaf-path walk', () => {
  test('flattens nested objects into dotted leaf paths', () => {
    const cat = { Share: { cta: 'Go', notFound: { heading: 'Gone' } }, common: { ok: 'OK' } };
    expect(keyPaths(cat).sort()).toEqual([
      'Share.cta',
      'Share.notFound.heading',
      'common.ok',
    ]);
  });

  test('treats arrays as leaves (not walked into)', () => {
    const cat = { X: { items: ['a', 'b'] } };
    expect(keyPaths(cat)).toEqual(['X.items']);
  });
});

describe('verifyParity — catches missing AND extra keys', () => {
  const en = { Share: { cta: 'Go', heading: 'Hello' }, common: { ok: 'OK' } };

  test('identical catalogs → ok, no missing, no extra', () => {
    const es = { Share: { cta: 'Ir', heading: 'Hola' }, common: { ok: 'Vale' } };
    const report = verifyParity({ en, es });
    expect(report.ok).toBe(true);
    expect(report.perLocale.es).toEqual({ missing: [], extra: [], ok: true });
  });

  test('a MISSING key in es is reported (and fails parity)', () => {
    const es = { Share: { cta: 'Ir' }, common: { ok: 'Vale' } }; // missing Share.heading
    const report = verifyParity({ en, es });
    expect(report.ok).toBe(false);
    expect(report.perLocale.es.missing).toEqual(['Share.heading']);
    expect(report.perLocale.es.extra).toEqual([]);
  });

  test('an EXTRA key in es is reported (and fails parity)', () => {
    const es = {
      Share: { cta: 'Ir', heading: 'Hola' },
      common: { ok: 'Vale', extra: 'stray' }, // common.extra not in en
    };
    const report = verifyParity({ en, es });
    expect(report.ok).toBe(false);
    expect(report.perLocale.es.extra).toEqual(['common.extra']);
    expect(report.perLocale.es.missing).toEqual([]);
  });

  test('reports BOTH missing and extra in one locale', () => {
    const es = {
      Share: { cta: 'Ir', subtitle: 'extra' }, // missing heading, extra subtitle
      common: { ok: 'Vale' },
    };
    const report = verifyParity({ en, es });
    expect(report.ok).toBe(false);
    expect(report.perLocale.es.missing).toEqual(['Share.heading']);
    expect(report.perLocale.es.extra).toEqual(['Share.subtitle']);
  });

  test('the source locale (first key) is the base; multiple locales each checked', () => {
    const es = { Share: { cta: 'Ir', heading: 'Hola' }, common: { ok: 'Vale' } };
    const ja = { Share: { cta: 'い', heading: 'やあ' }, common: {} }; // missing common.ok
    const report = verifyParity({ en, es, ja });
    expect(report.sourceLocale).toBe('en');
    expect(report.perLocale.es.ok).toBe(true);
    expect(report.perLocale.ja.ok).toBe(false);
    expect(report.perLocale.ja.missing).toEqual(['common.ok']);
    expect(report.ok).toBe(false);
  });
});

describe('emitParityTest — the cowpath test source', () => {
  test('imports every locale catalog and asserts each non-source matches the base', () => {
    const file = emitParityTest(['en', 'es', 'ja']);
    expect(file.path).toBe('src/__tests__/catalog-parity.test.ts');
    expect(file.contents).toContain("import en from '../../messages/en.json';");
    expect(file.contents).toContain("import es from '../../messages/es.json';");
    expect(file.contents).toContain("import ja from '../../messages/ja.json';");
    // the base derives off the source locale.
    expect(file.contents).toContain('const base = keyPaths(en as Record<string, unknown>).sort();');
    // a test.each row per non-source locale, none for en.
    expect(file.contents).toContain("['es', es],");
    expect(file.contents).toContain("['ja', ja],");
    expect(file.contents).not.toContain("['en', en],");
    // the recursive keyPaths helper is inlined (no plugin import in the app).
    expect(file.contents).toContain('function keyPaths(');
    expect(file.contents).toContain('describe(\'catalog parity\'');
  });

  test('honors custom messagesImport + testPath + sourceLocale', () => {
    const file = emitParityTest(['en', 'fr'], {
      messagesImport: '../messages',
      testPath: '__tests__/parity.test.ts',
      sourceLocale: 'en',
    });
    expect(file.path).toBe('__tests__/parity.test.ts');
    expect(file.contents).toContain("import fr from '../messages/fr.json';");
    expect(file.contents).toContain("['fr', fr],");
  });

  test('a single-locale app emits a valid (no-row) parity test', () => {
    const file = emitParityTest(['en']);
    expect(file.contents).toContain("import en from");
    // no other-locale rows, but still a well-formed test.each block.
    expect(file.contents).toContain('test.each([');
  });
});
