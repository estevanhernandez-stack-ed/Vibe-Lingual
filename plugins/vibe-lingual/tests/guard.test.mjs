// M7 — guard emitter tests. The react/jsx-no-literals override globs dynamic-route
// segments with '*' (NEVER the literal '[param]' — minimatch treats it as a char
// class and silently never matches), and each guarded file self-verifies via
// `eslint --print-config` (degrading to a structural verdict when eslint is not
// resolvable in the app).

import {
  emitGuard,
  toGuardGlob,
  hasDynamicSegment,
  renderGuardBlock,
  verifyGuard,
  verifyGuardFile,
  DEFAULT_ALLOWED_STRINGS,
} from '../engine/adapters/next-intl/guard.mjs';

describe("dynamic-route globbing — '*' never '[param]'", () => {
  test('a single dynamic segment collapses to *', () => {
    expect(toGuardGlob('src/app/s/[shareId]/page.tsx')).toBe('src/app/s/*/page.tsx');
  });

  test('catch-all and optional-catch-all segments also collapse to *', () => {
    expect(toGuardGlob('src/app/blog/[...slug]/page.tsx')).toBe('src/app/blog/*/page.tsx');
    expect(toGuardGlob('src/app/shop/[[...filters]]/page.tsx')).toBe('src/app/shop/*/page.tsx');
  });

  test('multiple dynamic segments each collapse independently', () => {
    expect(toGuardGlob('src/app/[lang]/post/[id]/page.tsx')).toBe('src/app/*/post/*/page.tsx');
  });

  test('a static path is unchanged', () => {
    expect(toGuardGlob('src/components/settings/LanguageSettings.tsx')).toBe(
      'src/components/settings/LanguageSettings.tsx',
    );
  });

  test('windows separators normalize to POSIX', () => {
    expect(toGuardGlob('src\\app\\s\\[shareId]\\page.tsx')).toBe('src/app/s/*/page.tsx');
  });

  test('hasDynamicSegment is true only when a [param] segment is present', () => {
    expect(hasDynamicSegment('src/app/s/[shareId]/page.tsx')).toBe(true);
    expect(hasDynamicSegment('src/components/X.tsx')).toBe(false);
  });
});

describe('emitGuard — the EslintOverride block', () => {
  test('globs dynamic routes + keeps static files, de-duped and sorted', () => {
    const override = emitGuard([
      'src/app/s/[shareId]/page.tsx',
      'src/components/settings/LanguageSettings.tsx',
      'src/app/s/[shareId]/page.tsx', // dup → collapses
    ]);
    expect(override.files).toEqual([
      'src/app/s/*/page.tsx',
      'src/components/settings/LanguageSettings.tsx',
    ]);
  });

  test('ratchets react/jsx-no-literals to error with the cowpath allowedStrings', () => {
    const override = emitGuard(['src/components/X.tsx']);
    const rule = override.rules['react/jsx-no-literals'];
    expect(rule[0]).toBe('error');
    expect(rule[1].allowedStrings).toEqual(DEFAULT_ALLOWED_STRINGS);
    expect(DEFAULT_ALLOWED_STRINGS).toEqual(['·', '—', '•']);
  });

  test('honors a custom allowedStrings list', () => {
    const override = emitGuard(['src/components/X.tsx'], { allowedStrings: ['·'] });
    expect(override.rules['react/jsx-no-literals'][1].allowedStrings).toEqual(['·']);
  });

  test('empty input yields an empty files glob list (no crash)', () => {
    expect(emitGuard([]).files).toEqual([]);
    expect(emitGuard().files).toEqual([]);
  });
});

describe('renderGuardBlock — flat-config source text', () => {
  test('emits a files[] block with the globbed dynamic route + the rule', () => {
    const override = emitGuard(['src/app/s/[shareId]/page.tsx']);
    const block = renderGuardBlock(override);
    expect(block).toContain('"src/app/s/*/page.tsx"');
    // the literal [shareId] must NEVER appear in the emitted block.
    expect(block).not.toContain('[shareId]');
    expect(block).toContain('"react/jsx-no-literals": ["error"');
  });
});

describe('self-verify — eslint --print-config (graceful degradation)', () => {
  test('with no resolvable eslint, returns a structural PASS + the command to run', () => {
    const override = emitGuard(['src/app/s/[shareId]/page.tsx']);
    const result = verifyGuardFile('src/app/s/[shareId]/page.tsx', override, {
      appRoot: '/tmp/no-such-app-root-xyz',
    });
    expect(result.ranEslint).toBe(false);
    expect(result.ok).toBe(true); // glob matches + rule present
    expect(result.glob).toBe('src/app/s/*/page.tsx');
    expect(result.command).toBe('eslint --print-config src/app/s/[shareId]/page.tsx');
    expect(result.severity).toBe('error');
  });

  test('structural verdict FAILS when the file is not covered by the override glob', () => {
    const override = emitGuard(['src/components/Other.tsx']);
    const result = verifyGuardFile('src/app/s/[shareId]/page.tsx', override, {
      appRoot: '/tmp/no-such-app-root-xyz',
    });
    expect(result.ranEslint).toBe(false);
    expect(result.ok).toBe(false);
  });

  test('verifyGuard rolls up per-file results + an allOk flag', () => {
    const report = verifyGuard(
      ['src/app/s/[shareId]/page.tsx', 'src/components/settings/LanguageSettings.tsx'],
      { appRoot: '/tmp/no-such-app-root-xyz' },
    );
    expect(report.results).toHaveLength(2);
    expect(report.allOk).toBe(true);
    expect(report.override.files).toContain('src/app/s/*/page.tsx');
  });
});
