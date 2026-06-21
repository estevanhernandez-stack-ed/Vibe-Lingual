// vibe-lingual engine — catalog parity (M7).
//
// The single highest-value reusable guard the plugin emits (cowpath lesson 5c): a
// RECURSIVE key-path equality test across all message catalogs. It catches BOTH
// missing keys (a locale forgot one) AND extra keys (a locale grew a stray one) —
// a flat top-level diff misses nested drift, so the check walks every leaf path.
//
// Two faces:
//   1. emitParityTest(locales, options) -> File   — the test SOURCE the plugin
//      writes into the app's test suite, modeled byte-for-byte on the proven
//      Celestia3 cowpath (src/__tests__/catalog-parity.test.ts): import each
//      catalog, derive sorted leaf key-paths off the source locale, and assert
//      every other catalog has EXACTLY the same set.
//   2. verifyParity(catalogs) -> report           — run the same check in-process
//      (the engine's own verification, used by tests + the SKILL before it writes
//      the guard) so a parity failure is caught without spawning jest.

// ---------------------------------------------------------------------------
// the recursive key-path walk — the shared core of emit + verify.
// A leaf is any non-object (or null) value; its path is the dotted ancestry.
// ---------------------------------------------------------------------------

export function keyPaths(obj, prefix = '') {
  if (obj == null || typeof obj !== 'object') return prefix ? [prefix] : [];
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return v && typeof v === 'object' && !Array.isArray(v) ? keyPaths(v, path) : [path];
  });
}

// ---------------------------------------------------------------------------
// verifyParity(catalogs) — programmatic check.
//   catalogs: { en: {...}, es: {...}, ... }  (the source locale is the first key,
//   or options.sourceLocale). Returns:
//     { ok, sourceLocale, base: string[], perLocale: { [code]: { missing, extra, ok } } }
//   `missing` = keys in the source NOT in this locale; `extra` = keys in this
//   locale NOT in the source. ok === every locale has zero missing + zero extra.
// ---------------------------------------------------------------------------

export function verifyParity(catalogs, options = {}) {
  const codes = Object.keys(catalogs || {});
  const sourceLocale = options.sourceLocale || codes[0] || 'en';
  const base = keyPaths(catalogs[sourceLocale] || {}).sort();
  const baseSet = new Set(base);

  const perLocale = {};
  let allOk = true;
  for (const code of codes) {
    if (code === sourceLocale) continue;
    const paths = keyPaths(catalogs[code] || {}).sort();
    const pathSet = new Set(paths);
    const missing = base.filter((p) => !pathSet.has(p));
    const extra = paths.filter((p) => !baseSet.has(p));
    const ok = missing.length === 0 && extra.length === 0;
    if (!ok) allOk = false;
    perLocale[code] = { missing, extra, ok };
  }

  return { ok: allOk, sourceLocale, base, perLocale };
}

// ---------------------------------------------------------------------------
// emitParityTest(locales, options) -> File { path, contents }
//   Renders the cowpath test. `locales[0]` (or options.sourceLocale) is the base;
//   every other locale is asserted to have EXACTLY the same key set. The import
//   path to the messages dir and the test file path follow the src-dir convention
//   (options.messagesImport / options.testPath override the defaults).
// ---------------------------------------------------------------------------

export function emitParityTest(locales, options = {}) {
  const codes = Array.isArray(locales) && locales.length > 0 ? locales : ['en'];
  const sourceLocale = options.sourceLocale || codes[0];
  const others = codes.filter((c) => c !== sourceLocale);

  // import path from the test file to the messages catalogs. The cowpath test
  // sits at src/__tests__/catalog-parity.test.ts and imports ../../messages.
  const messagesImport = options.messagesImport || '../../messages';
  const testPath = options.testPath || 'src/__tests__/catalog-parity.test.ts';

  const imports = codes
    .map((c) => `import ${c} from '${messagesImport}/${c}.json';`)
    .join('\n');

  // test.each rows for every non-source locale.
  const eachRows = others.map((c) => `    ['${c}', ${c}],`).join('\n');

  const contents = `${imports}

// Recursive key-path parity across all message catalogs — catches BOTH missing
// AND extra keys (a flat top-level diff misses nested drift). Emitted by
// vibe-lingual's parity guard (cowpath lesson 5c). '${sourceLocale}' is the
// source-of-truth key set; every other locale must match it EXACTLY.
function keyPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? \`\${prefix}.\${k}\` : k;
    return v && typeof v === 'object'
      ? keyPaths(v as Record<string, unknown>, path)
      : [path];
  });
}

describe('catalog parity', () => {
  const base = keyPaths(${sourceLocale} as Record<string, unknown>).sort();

  test.each([
${eachRows}
  ])('%s has exactly the same keys as ${sourceLocale}', (_name, cat) => {
    expect(keyPaths(cat as Record<string, unknown>).sort()).toEqual(base);
  });
});
`;

  return { path: testPath, contents };
}

export default { keyPaths, verifyParity, emitParityTest };
