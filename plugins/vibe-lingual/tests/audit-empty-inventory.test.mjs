// M8 hardening — audit must FAIL LOUD on a missing/empty/malformed inventory.
//
// The bug this guards against: a previous audit handed an empty inventory emitted
// a report carrying only the always-on app-level RTL info gotcha — a vacuous
// "clean" surface that hides the fact that nothing was actually scanned. The
// engine now throws a clear error instead, so the CLI exits non-zero and the SKILL
// aborts rather than trusting a hollow report.

import { audit } from '../engine/audit.mjs';

const EMPTY_INVENTORY = {
  schemaVersion: 1,
  app: { root: '.', framework: 'none', routerType: 'app', turbopack: false, ssrFiles: [] },
  existingI18n: { lib: null, languageList: null, localePref: null },
  sites: [],
  countsByKind: {
    'jsx-text': 0,
    placeholder: 0,
    'aria-label': 0,
    title: 0,
    alt: 0,
    toast: 0,
    'date-intl': 0,
  },
  componentsByDensity: [],
};

describe('audit fails loud on a bad inventory', () => {
  test('throws on a null/undefined inventory', () => {
    expect(() => audit(null, '/app')).toThrow(/inventory is missing or not an object/);
    expect(() => audit(undefined, '/app')).toThrow(/inventory is missing or not an object/);
  });

  test('throws on a malformed inventory (missing sites[] / componentsByDensity[])', () => {
    expect(() => audit({ schemaVersion: 1 }, '/app')).toThrow(/malformed/);
    expect(() => audit({ sites: [] }, '/app')).toThrow(/malformed/);
    expect(() => audit({ componentsByDensity: [] }, '/app')).toThrow(/malformed/);
  });

  test('throws on an EMPTY inventory (zero sites + zero files) instead of an RTL-only report', () => {
    expect(() => audit(EMPTY_INVENTORY, '/app')).toThrow(/EMPTY/);
  });

  test('does NOT throw when the inventory has at least one file with work', () => {
    const nonEmpty = {
      ...EMPTY_INVENTORY,
      sites: [
        {
          file: 'src/components/Card.tsx',
          line: 3,
          kind: 'jsx-text',
          text: 'Hello',
          suggestedNamespace: 'Card',
          suggestedKey: 'hello',
          confidence: 'high',
          structuralIntl: false,
        },
      ],
      componentsByDensity: [{ file: 'src/components/Card.tsx', count: 1 }],
    };
    expect(() => audit(nonEmpty, '/app')).not.toThrow();
  });
});
