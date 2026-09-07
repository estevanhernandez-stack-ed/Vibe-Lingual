// wpf-resx adapter (2026-09-06) — the mutating half of the WPF stack. The
// transform rides the scanner's own tokenizer spans; staging is honest (never
// guessed markup surgery); the extract loop is backed up and idempotent.

import { mkdtempSync, cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detect } from '../engine/detect.mjs';
import { scan } from '../engine/scan.mjs';
import { resolveAdapter } from '../engine/adapters/index.mjs';
import { wpfResxAdapter } from '../engine/adapters/wpf-resx/index.mjs';
import { transformXamlSource } from '../engine/adapters/wpf-resx/transform.mjs';
import { emitResx, parseResx, mergeResxEntries, KeyRegistry } from '../engine/adapters/wpf-resx/resx.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WPF_APP = join(here, 'fixtures', 'wpf-app');

const mainWindowXaml = () => readFileSync(join(WPF_APP, 'Views', 'MainWindow.xaml'), 'utf8');
const settingsPageXaml = () => readFileSync(join(WPF_APP, 'Preferences', 'SettingsPage.xaml'), 'utf8');

function freshOptions() {
  return { clrNamespace: 'FixtureApp.Properties', registry: new KeyRegistry() };
}

describe('wpf-resx — keys and resx machinery', () => {
  test('keys are C# identifiers, deduped by (namespace, text), suffixed on collision', () => {
    const r = new KeyRegistry();
    const a = r.keyFor('SettingsPage', 'pasteYourWebhookUrl', 'Paste your webhook URL');
    const b = r.keyFor('SettingsPage', 'pasteYourWebhookUrl', 'Paste your webhook URL');
    const c = r.keyFor('SettingsPage', 'pasteYourWebhookUrl', 'A different text, same slug');
    expect(a).toBe('SettingsPage_PasteYourWebhookUrl');
    expect(b).toBe(a); // same namespace+text → same key
    expect(c).toBe('SettingsPage_PasteYourWebhookUrl_2');
    expect(/^[A-Za-z_][A-Za-z0-9_]*$/.test(c)).toBe(true);
  });

  test('emitResx/parseResx round-trip, XML-escaped', () => {
    const entries = [
      { key: 'A_SaveClose', value: 'Save & close', comment: 'x:1' },
      { key: 'B_Angle', value: 'a < b' },
    ];
    const xml = emitResx(entries);
    expect(xml).toContain('text/microsoft-resx');
    expect(xml).toContain('Save &amp; close');
    const back = parseResx(xml);
    expect(back).toEqual([
      { key: 'A_SaveClose', value: 'Save & close' },
      { key: 'B_Angle', value: 'a < b' },
    ]);
  });

  test('mergeResxEntries is idempotent and reuses keys for identical values', () => {
    const existing = [{ key: 'X_One', value: 'One' }];
    const first = mergeResxEntries(existing, [
      { key: 'Y_One', value: 'One' }, // value reuse → remap to X_One
      { key: 'X_Two', value: 'Two' },
    ]);
    expect(first.added).toBe(1);
    expect(first.keyRemap.get('Y_One')).toBe('X_One');
    const again = mergeResxEntries(first.entries, [{ key: 'X_Two', value: 'Two' }]);
    expect(again.added).toBe(0);
  });
});

describe('wpf-resx — the XAML transform', () => {
  test('display attributes become x:Static references; machinery is untouched', () => {
    const res = transformXamlSource(mainWindowXaml(), 'Views/MainWindow.xaml', freshOptions());
    expect(res.changed).toBe(true);
    expect(res.newText).toContain('Title="{x:Static loc:Strings.MainWindow_');
    expect(res.newText).toContain('ToolTip="{x:Static loc:Strings.MainWindow_');
    expect(res.newText).toContain('AutomationProperties.Name="{x:Static loc:Strings.MainWindow_');
    // bindings and resources survive verbatim
    expect(res.newText).toContain('Text="{Binding StatusBanner}"');
    expect(res.newText).toContain('Content="{Binding DynamicLabel}"');
    expect(res.newText).toContain('Style="{DynamicResource BodyTextStyle}"');
    expect(res.newText).toContain('<Run Text="42" />');
    // no literal copy remains
    expect(res.newText).not.toContain('Add an account to get started');
    expect(res.newText).not.toContain('Launch As');
  });

  test('the {} escape is honored: the literal (braces included) moves into the catalog', () => {
    const res = transformXamlSource(mainWindowXaml(), 'Views/MainWindow.xaml', freshOptions());
    const entry = res.entries.find((e) => e.value.startsWith('{escaped}'));
    expect(entry).toBeDefined();
    expect(res.newText).not.toContain('{}{escaped}');
  });

  test('sole-content text collapses into the element text property', () => {
    const res = transformXamlSource(mainWindowXaml(), 'Views/MainWindow.xaml', freshOptions());
    expect(res.newText).not.toContain('Accounts you saved show up here.');
    expect(res.newText).toMatch(/<TextBlock Text="\{x:Static loc:Strings\.MainWindow_[A-Za-z0-9_]+\}" \/>/);
  });

  test('xmlns:loc is inserted once, on the root element', () => {
    const res = transformXamlSource(mainWindowXaml(), 'Views/MainWindow.xaml', freshOptions());
    const hits = res.newText.match(/xmlns:loc="clr-namespace:FixtureApp\.Properties"/g) || [];
    expect(hits.length).toBe(1);
    expect(res.newText.indexOf('xmlns:loc')).toBeLessThan(res.newText.indexOf('<Grid'));
  });

  test('Setter display values rewrite; non-display Setters and property elements stage', () => {
    const res = transformXamlSource(settingsPageXaml(), 'Preferences/SettingsPage.xaml', freshOptions());
    expect(res.newText).toContain('<Setter Property="Content" Value="{x:Static loc:Strings.SettingsPage_');
    expect(res.newText).toContain('Value="#FF0000"'); // Background stays
    expect(res.newText).toContain('PlaceholderText="{x:Static loc:Strings.SettingsPage_');
    // <Button.Content>Save &amp; close</Button.Content> needs hand conversion
    expect(res.newText).toContain('Save &amp; close');
    const stagedTexts = res.staged.map((s) => s.text);
    expect(stagedTexts).toContain('Save & close');
    expect(res.staged[0].reason).toMatch(/property-element|not the sole content|already sets|no known text property/);
  });

  test('idempotent: transforming a transformed document changes nothing', () => {
    const opts = freshOptions();
    const first = transformXamlSource(mainWindowXaml(), 'Views/MainWindow.xaml', opts);
    const second = transformXamlSource(first.newText, 'Views/MainWindow.xaml', freshOptions());
    expect(second.changed).toBe(false);
    expect(second.entries).toEqual([]);
  });
});

describe('wpf-resx — wire, parity, guard emitters', () => {
  test('wire() plans the resx template, culture bootstrap, and honesty notes', () => {
    const plan = wpfResxAdapter.wire({ clrNamespace: 'FixtureApp.Properties', locales: ['fr', 'de'] });
    expect(plan.files.map((f) => f.path)).toEqual([
      'Properties/Strings.resx',
      'Properties/CultureBootstrap.cs.snippet',
    ]);
    expect(plan.patches.map((p) => p.kind)).toEqual(['resx-public-codegen', 'culture-bootstrap']);
    expect(plan.notes.join('\n')).toMatch(/manifest declares a language ONLY/);
    expect(plan.notes.join('\n')).toContain('Strings.fr.resx');
  });

  test('emitParityTest emits a C# fence over the given cultures', () => {
    const file = wpfResxAdapter.emitParityTest(['fr', 'pl'], {
      testNamespace: 'Fixture.Tests',
      appProjectDir: 'src/App',
      testProjectDir: 'src/Fixture.Tests',
    });
    expect(file.path).toBe('src/Fixture.Tests/ResxParityFenceTests.cs');
    expect(file.contents).toContain('namespace Fixture.Tests;');
    expect(file.contents).toContain('"fr", "pl"');
    expect(file.contents).toContain('EveryCultureCatalogMatchesTheNeutralKeySet');
  });

  test('emitGuard emits the display-literal ratchet over the extracted files', () => {
    const file = wpfResxAdapter.emitGuard(['src/App/Views/MainWindow.xaml'], { testNamespace: 'Fixture.Tests' });
    expect(file.contents).toContain('src/App/Views/MainWindow.xaml');
    expect(file.contents).toContain('ExtractedFilesCarryNoDisplayLiterals');
  });
});

describe('wpf-resx — registry + extract loop', () => {
  test('a WPF detection now resolves READY to the implemented adapter', () => {
    const res = resolveAdapter({ app: { stack: 'wpf', framework: 'none' }, existingI18n: { lib: null } });
    expect(res.status).toBe('ready');
    expect(res.adapter).toBe(wpfResxAdapter);
    expect(res.framework).toBe('wpf-resx');
  });

  test('extractXaml: dry-run writes nothing; a real run rewrites, catalogs, backs up, and re-runs clean', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wpf-resx-'));
    try {
      cpSync(WPF_APP, tmp, { recursive: true });
      const inventory = scan(tmp, detect(tmp));
      expect(inventory.app.stack).toBe('wpf');

      const before = {
        mainWindow: readFileSync(join(tmp, 'Views', 'MainWindow.xaml'), 'utf8'),
        resx: readFileSync(join(tmp, 'Properties', 'Strings.resx'), 'utf8'),
      };
      const dry = wpfResxAdapter.extractXaml(tmp, inventory, {
        clrNamespace: 'FixtureApp.Properties',
        dryRun: true,
      });
      expect(dry.filesChanged).toBeGreaterThan(0);
      // dry-run mutates NOTHING — the fixture's pre-existing resx and every
      // XAML file keep their exact bytes, and no backup batch is opened.
      expect(readFileSync(join(tmp, 'Views', 'MainWindow.xaml'), 'utf8')).toBe(before.mainWindow);
      expect(readFileSync(join(tmp, 'Properties', 'Strings.resx'), 'utf8')).toBe(before.resx);
      expect(dry.batchId).toBeNull();
      expect(existsSync(join(tmp, '.vibe-lingual'))).toBe(false);

      const real = wpfResxAdapter.extractXaml(tmp, inventory, {
        clrNamespace: 'FixtureApp.Properties',
        locales: ['fr'],
      });
      expect(real.filesChanged).toBe(2);
      expect(real.entriesAdded).toBeGreaterThanOrEqual(9);
      expect(real.staged.length).toBeGreaterThanOrEqual(1);
      expect(existsSync(join(tmp, 'Properties', 'Strings.resx'))).toBe(true);
      expect(existsSync(join(tmp, 'Properties', 'Strings.fr.resx'))).toBe(true);
      expect(existsSync(join(tmp, '.vibe-lingual', 'localize', 'backup', real.batchId))).toBe(true);
      expect(readFileSync(join(tmp, 'Views', 'MainWindow.xaml'), 'utf8')).toContain('{x:Static loc:Strings.');

      const fr = parseResx(readFileSync(join(tmp, 'Properties', 'Strings.fr.resx'), 'utf8'));
      const neutral = parseResx(readFileSync(join(tmp, 'Properties', 'Strings.resx'), 'utf8'));
      expect(new Set(fr.map((e) => e.key))).toEqual(new Set(neutral.map((e) => e.key)));

      // idempotent second run over the already-transformed tree
      const again = wpfResxAdapter.extractXaml(tmp, scan(tmp, detect(tmp)), {
        clrNamespace: 'FixtureApp.Properties',
        locales: ['fr'],
      });
      expect(again.filesChanged).toBe(0);
      expect(again.entriesAdded).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
