// Phase-3 hardening — built-in ignore-pattern respect.
//
// The scanner must auto-exclude files the APP itself ignores so the operator never
// hand-prunes the inventory (Phase 2 had to MANUALLY exclude Celestia3's legacy/).
// Three signals + built-in defaults:
//   - .gitignore                       (gitignore syntax)
//   - .eslintignore                    (gitignore syntax, legacy)
//   - eslint.config.* globalIgnores([…]) (flat-config globs: legacy/**, functions/**)
//   - built-in defaults                (node_modules/.next/dist/build/legacy/functions)
//
// Asserts (a) the matcher unit behavior, (b) the scan() integration: ignored files
// are NOT in the inventory, the kept file IS, and a missing/malformed ignore file
// degrades to the defaults without crashing.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detect } from '../engine/detect.mjs';
import { scan } from '../engine/scan.mjs';
import { buildIgnoreMatcher, DEFAULT_EXCLUDE_DIRS } from '../engine/ignore.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIX = join(__dirname, 'fixtures');
const IGNORE_APP = join(FIX, 'ignore-app');
const NOCONFIG_APP = join(FIX, 'ignore-noconfig-app');
const MALFORMED_APP = join(FIX, 'ignore-malformed-app');

const filesIn = (inv) => new Set(inv.sites.map((s) => s.file));
const hasFile = (inv, substr) => inv.sites.some((s) => s.file.includes(substr));

// ---------------------------------------------------------------------------
// (a) buildIgnoreMatcher — unit behavior
// ---------------------------------------------------------------------------
describe('ignore — buildIgnoreMatcher unit', () => {
  const m = buildIgnoreMatcher(IGNORE_APP, { extraExcludeDirs: ['out'] });

  test('reports all three signal sources as contributing', () => {
    expect(m.sources.defaults).toBe(true);
    expect(m.sources.gitignore).toBe(true);
    expect(m.sources.eslintignore).toBe(true);
    expect(m.sources.eslintConfig).toBe(true);
  });

  test('eslint globalIgnores legacy/** + functions/** are matched at any depth', () => {
    expect(m.isIgnored('legacy/IntroSplash.tsx')).toBe(true);
    expect(m.isIgnored('functions/src/notify.ts')).toBe(true);
  });

  test('gitignored /scripts is matched (root-anchored dir)', () => {
    expect(m.isIgnored('scripts/analyze.tsx')).toBe(true);
  });

  test('eslintignored src/vendored/ is matched (trailing-slash dir)', () => {
    expect(m.isIgnored('src/vendored/ThirdParty.tsx')).toBe(true);
  });

  test('a normal source file is NOT ignored', () => {
    expect(m.isIgnored('src/components/WelcomePanel.tsx')).toBe(false);
  });

  test('native (backslash) separators are accepted and normalized', () => {
    expect(m.isIgnored('legacy\\IntroSplash.tsx')).toBe(true);
    expect(m.isIgnored('src\\components\\WelcomePanel.tsx')).toBe(false);
  });

  test('the built-in default dirs are always excluded even without an ignore file', () => {
    const bare = buildIgnoreMatcher(NOCONFIG_APP);
    for (const dir of DEFAULT_EXCLUDE_DIRS) {
      expect(bare.isIgnored(`${dir}/anything.tsx`)).toBe(true);
    }
    expect(bare.sources.gitignore).toBe(false);
    expect(bare.sources.eslintConfig).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) scan() integration — the inventory must not contain ignored files
// ---------------------------------------------------------------------------
describe('ignore — scan() excludes ignored files from the inventory', () => {
  const inv = scan(IGNORE_APP, detect(IGNORE_APP));

  test('the kept source file IS in the inventory (sanity — the test app has real sites)', () => {
    expect(hasFile(inv, 'WelcomePanel')).toBe(true);
  });

  test('eslint-globalIgnores legacy/ files are NOT in the inventory', () => {
    expect(hasFile(inv, 'legacy/')).toBe(false);
    expect(hasFile(inv, 'IntroSplash')).toBe(false);
  });

  test('eslint-globalIgnores functions/ (a separate package) is NOT in the inventory', () => {
    expect(hasFile(inv, 'functions/')).toBe(false);
    expect(hasFile(inv, 'notify')).toBe(false);
  });

  test('gitignored /scripts is NOT in the inventory', () => {
    expect(hasFile(inv, 'scripts/')).toBe(false);
  });

  test('eslintignored src/vendored/ is NOT in the inventory', () => {
    expect(hasFile(inv, 'vendored')).toBe(false);
  });

  test('no inventory site lives under any ignored directory', () => {
    for (const f of filesIn(inv)) {
      expect(f).not.toMatch(/(^|\/)(legacy|functions|scripts|vendored|node_modules|\.next|dist|build)\//);
    }
  });

  test('the brief _meta records which ignore signals fired', () => {
    expect(inv._meta.ignoreSources.gitignore).toBe(true);
    expect(inv._meta.ignoreSources.eslintConfig).toBe(true);
    expect(inv._meta.ignoreSources.eslintignore).toBe(true);
    expect(inv._meta.ignorePatternCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (c) fallback — no ignore files: built-in defaults still exclude legacy/
// ---------------------------------------------------------------------------
describe('ignore — no ignore files falls back to built-in defaults', () => {
  const inv = scan(NOCONFIG_APP, detect(NOCONFIG_APP));

  test('the kept source file IS in the inventory', () => {
    expect(hasFile(inv, 'HomePanel')).toBe(true);
  });

  test('legacy/ is STILL excluded by the documented default list (no config present)', () => {
    expect(hasFile(inv, 'legacy/')).toBe(false);
    expect(hasFile(inv, 'OldThing')).toBe(false);
  });

  test('_meta shows only defaults contributed (no git/eslint signals)', () => {
    expect(inv._meta.ignoreSources.defaults).toBe(true);
    expect(inv._meta.ignoreSources.gitignore).toBe(false);
    expect(inv._meta.ignoreSources.eslintConfig).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (d) robustness — a malformed eslint config must NOT crash the scan
// ---------------------------------------------------------------------------
describe('ignore — malformed eslint config degrades to defaults, never throws', () => {
  test('scan() does not throw on an unparseable eslint.config.mjs', () => {
    expect(() => scan(MALFORMED_APP, detect(MALFORMED_APP))).not.toThrow();
  });

  const inv = scan(MALFORMED_APP, detect(MALFORMED_APP));

  test('the kept source file survives in the inventory', () => {
    expect(hasFile(inv, 'MainPanel')).toBe(true);
  });

  test('legacy/ is still excluded by the built-in default list', () => {
    expect(hasFile(inv, 'legacy/')).toBe(false);
    expect(hasFile(inv, 'Junk')).toBe(false);
  });

  test('the unparseable globalIgnores contributes no eslintConfig source', () => {
    // the matcher found no compilable globalIgnores globs → eslintConfig stays false
    expect(inv._meta.ignoreSources.eslintConfig).toBe(false);
  });
});
