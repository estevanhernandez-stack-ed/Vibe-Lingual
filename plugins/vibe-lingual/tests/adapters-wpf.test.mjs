// The wpf-resx adapter in the registry (graduated from stub 2026-09-06): a WPF
// detection resolves READY; JS apps are never claimed by it.

import { resolveAdapter } from '../engine/adapters/index.mjs';

describe('adapter registry — wpf-resx', () => {
  test('a WPF detection resolves ready to wpf-resx', () => {
    const res = resolveAdapter({
      app: { stack: 'wpf', framework: 'none', routerType: 'unknown' },
      existingI18n: { lib: 'resx', languageList: null, localePref: null },
    });
    expect(res.status).toBe('ready');
    expect(res.adapter && res.adapter.id).toBe('wpf-resx');
    expect(res.framework).toBe('wpf-resx');
  });

  test('a JS app is never claimed by wpf-resx', () => {
    const res = resolveAdapter({
      app: { stack: 'js', framework: 'react-i18next', routerType: 'pages' },
      existingI18n: { lib: 'react-i18next', languageList: null, localePref: null },
    });
    expect(res.framework).not.toBe('wpf-resx');
  });
});
