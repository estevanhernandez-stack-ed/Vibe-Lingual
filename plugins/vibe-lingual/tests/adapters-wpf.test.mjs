// The wpf-resx stub (M5 seam, WPF stack 2026-09-05): the registry NAMES the WPF
// stack and stands down honestly — the mutating side stays not-yet-implemented.

import { resolveAdapter } from '../engine/adapters/index.mjs';

describe('adapter registry — wpf-resx stub', () => {
  test('a WPF detection resolves to not-yet-implemented, named by the stack', () => {
    const res = resolveAdapter({
      app: { stack: 'wpf', framework: 'none', routerType: 'unknown' },
      existingI18n: { lib: 'resx', languageList: null, localePref: null },
    });
    expect(res.adapter).toBeNull();
    expect(res.status).toBe('not-yet-implemented');
    expect(res.framework).toBe('wpf-resx');
  });

  test('a JS app is never claimed by the wpf-resx stub', () => {
    const res = resolveAdapter({
      app: { stack: 'js', framework: 'react-i18next', routerType: 'pages' },
      existingI18n: { lib: 'react-i18next', languageList: null, localePref: null },
    });
    expect(res.framework).not.toBe('wpf-resx');
  });
});
