// WPF stack detection (2026-09-05 change). The probe runs only when the JS
// probes come up empty, keys off csproj markers, and maps resx presence to
// existingI18n.lib — while the JS path stays byte-identical apart from the
// additive `stack: 'js'` field.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detect } from '../engine/detect.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WPF_APP = join(here, 'fixtures', 'wpf-app');
const JS_APP = join(here, 'fixtures', 'app-router-no-intl');

describe('detect — WPF stack', () => {
  test('a WPF app is classified by its csproj markers', () => {
    const d = detect(WPF_APP);
    expect(d.app.stack).toBe('wpf');
    expect(d.app.framework).toBe('none');
    expect(d.app.wpf.csprojFiles).toEqual(['FixtureApp.csproj']);
  });

  test('the XAML surface count excludes generated *.g.xaml and obj/', () => {
    const d = detect(WPF_APP);
    expect(d.app.wpf.xamlFileCount).toBe(2);
  });

  test('resx presence maps to existingI18n.lib "resx"; the JS-only pref concepts stay null', () => {
    const d = detect(WPF_APP);
    expect(d.existingI18n.lib).toBe('resx');
    expect(d.app.wpf.resxFiles).toEqual(['Properties/Strings.resx']);
    expect(d.existingI18n.languageList).toBeNull();
    expect(d.existingI18n.localePref).toBeNull();
  });

  test('a JS app keeps stack "js" and carries no wpf block', () => {
    const d = detect(JS_APP);
    expect(d.app.stack).toBe('js');
    expect(d.app.wpf).toBeUndefined();
  });
});
