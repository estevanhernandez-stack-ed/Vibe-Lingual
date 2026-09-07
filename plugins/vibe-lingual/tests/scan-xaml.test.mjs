// XAML scanner (WPF stack, 2026-09-05). The whitelist finds display copy, the
// tokenizer refuses machinery (bindings, comments, generated files, noise
// attributes), and the inventory comes out in the same shape scan.mjs produces —
// dispatched through the ordinary scan() entry point.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detect } from '../engine/detect.mjs';
import { scan } from '../engine/scan.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const WPF_APP = join(here, 'fixtures', 'wpf-app');

function scanFixture() {
  return scan(WPF_APP, detect(WPF_APP));
}

function texts(inv, kind) {
  return inv.sites.filter((s) => s.kind === kind).map((s) => s.text).sort();
}

describe('scan — XAML (WPF stack)', () => {
  test('display attributes, element text, Setter values, and property-element syntax are inventoried', () => {
    const inv = scanFixture();
    expect(texts(inv, 'xaml-text')).toEqual(
      [
        'Fixture — main window',
        'Add an account to get started',
        'Accounts you saved show up here.',
        'Launch As',
        '{escaped} braces are literal here',
        'Retry',
        'Settings', // PageHeader Heading — the display-property whitelist addition
        'Alerts',
        'Save & close',
      ].sort(),
    );
    expect(texts(inv, 'title')).toEqual(['Starts this account in its own client']);
    expect(texts(inv, 'aria-label')).toEqual(['Launch the selected account']);
    expect(texts(inv, 'placeholder')).toEqual(['Paste your webhook URL']);
  });

  test('machinery never enters the inventory: bindings, comments, digits, identifiers, noise attrs, generated files', () => {
    const inv = scanFixture();
    const allTexts = inv.sites.map((s) => s.text).join('\n');
    expect(allTexts).not.toMatch(/Binding|DynamicResource/); // markup extensions
    expect(allTexts).not.toContain('Fake copy'); // comment
    expect(allTexts).not.toContain('42'); // no letters
    expect(allTexts).not.toContain('camelCaseIdentifier'); // identifier-shaped
    expect(allTexts).not.toContain('RootGrid'); // x:Name is not a display attr
    expect(allTexts).not.toContain('#FF0000'); // Setter for a non-display property
    expect(allTexts).not.toContain('Space Grotesk'); // FontFamily value element — a font stack, not copy
    expect(allTexts).not.toContain('Generated copy'); // *.g.xaml under obj/
  });

  test('the XAML escape prefix marks a literal — captured with the {} stripped, at reduced confidence', () => {
    const inv = scanFixture();
    const site = inv.sites.find((s) => s.text.startsWith('{escaped}'));
    expect(site).toBeDefined();
    expect(site.kind).toBe('xaml-text');
    expect(site.confidence).toBe('medium'); // brace content is interpolation-ish
  });

  test('the inventory shape matches the JS scanner contract', () => {
    const inv = scanFixture();
    expect(inv.schemaVersion).toBe(1);
    expect(inv.app.stack).toBe('wpf');
    expect(inv.countsByKind['xaml-text']).toBe(9);
    expect(inv.countsByKind.title).toBe(1);
    expect(inv.countsByKind['aria-label']).toBe(1);
    expect(inv.countsByKind.placeholder).toBe(1);
    expect(inv.countsByKind['jsx-text']).toBe(0);
    expect(inv.componentsByDensity[0]).toEqual({ file: 'Views/MainWindow.xaml', count: 7 });
    expect(inv.componentsByDensity[1]).toEqual({ file: 'Preferences/SettingsPage.xaml', count: 5 });
    for (const s of inv.sites) {
      expect(typeof s.line).toBe('number');
      expect(s.line).toBeGreaterThan(0);
      expect(typeof s.suggestedNamespace).toBe('string');
      expect(typeof s.suggestedKey).toBe('string');
      expect(['high', 'medium', 'low']).toContain(s.confidence);
      expect(s.structuralIntl).toBe(false);
    }
    const namespaces = new Set(inv.sites.map((s) => s.suggestedNamespace));
    expect(namespaces).toEqual(new Set(['MainWindow', 'SettingsPage']));
  });
});
