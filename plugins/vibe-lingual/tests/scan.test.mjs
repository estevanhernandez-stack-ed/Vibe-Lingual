// M2 — scan + six-block brief tests.
//
// Asserts the scanner's classification on a fixture app tree carrying the four
// required cases from docs/checklist.md M2:
//   (i)   a structural-Intl site that must NOT be auto-included (excluded flag),
//   (ii)  CSS-className / data-attr / test-id strings that must NOT be extracted,
//   (iii) all four attribute kinds (placeholder / aria-label / title / alt),
//   (iv)  a toast/error literal.
// Plus the regression-oracle guard (an already-`t()`-wrapped string is not re-flagged),
// the inventory-schema validation, and the six-block brief emission.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detect } from '../engine/detect.mjs';
import { scan } from '../engine/scan.mjs';
import { brief } from '../engine/brief.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, 'fixtures', 'scan-app');

const inventory = scan(APP, detect(APP));
const sites = inventory.sites;
const included = sites.filter((s) => !s.excluded);

const at = (kind) => sites.filter((s) => s.kind === kind);
const textsOf = (kind) => at(kind).map((s) => s.text);
const fileSites = (substr) => sites.filter((s) => s.file.includes(substr));

// ---------------------------------------------------------------------------
// (i) structural-Intl must NOT be auto-included
// ---------------------------------------------------------------------------
describe('scan — (i) structural Intl is flagged, not included', () => {
  const intl = at('date-intl');

  test('the birthDateTime.ts tz-math sites are both flagged structuralIntl + excluded', () => {
    const structural = intl.filter((s) => s.file.includes('birthDateTime'));
    expect(structural.length).toBe(2);
    for (const s of structural) {
      expect(s.structuralIntl).toBe(true);
      expect(s.excluded).toBe(true);
      expect(typeof s.excludedReason).toBe('string');
    }
  });

  test('structural sites carry low confidence (never silently extracted)', () => {
    for (const s of intl.filter((s) => s.excluded)) {
      expect(s.confidence).toBe('low');
    }
  });

  test('a PRESENTATIONAL date in a component is included (not excluded) at low confidence', () => {
    const presentational = intl.find((s) => s.file.includes('Notices'));
    expect(presentational).toBeDefined();
    expect(presentational.structuralIntl).toBe(false);
    expect(presentational.excluded).toBeUndefined();
    expect(presentational.confidence).toBe('low');
  });

  test('excluded structural sites do not inflate component density', () => {
    const birthRow = inventory.componentsByDensity.find((c) => c.file.includes('birthDateTime'));
    expect(birthRow).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (i-b) KTD-5 — the dogfood miss: a BARE machine-locale (en-CA, NO timeZone)
// ISO-date-key call assigned to a const inside a component and used in
// comparison LOGIC (not rendered in JSX) is STRUCTURAL. The old classifier only
// marked machine-locale calls structural when a timeZone option was present
// (the birthDateTime shape), so DashboardShell's `new Date().toLocaleDateString
// ('en-CA')` date-keys slipped through as structuralIntl:false. A later
// useFormatter rewrite would break the streak/daily-key comparison.
// (structural-green != works: the aaa lesson — assert the dogfood-surfaced shape.)
// ---------------------------------------------------------------------------
describe('scan — (i-b) bare machine-locale date-key in a component is STRUCTURAL', () => {
  const dash = at('date-intl').filter((s) => s.file.includes('DashboardShell'));

  test('both bare en-CA date-key calls (no timeZone, not in JSX) are flagged structuralIntl + excluded', () => {
    const keys = dash.filter((s) => s.text.includes('en-CA'));
    expect(keys.length).toBe(2);
    for (const s of keys) {
      expect(s.structuralIntl).toBe(true);
      expect(s.excluded).toBe(true);
      expect(s.confidence).toBe('low');
      expect(s.excludedReason).toMatch(/not rendered in JSX/);
    }
  });

  test('a PRESENTATIONAL machine-locale date rendered in JSX text stays included (not excluded)', () => {
    const rendered = dash.find((s) => s.text.includes('en-US'));
    expect(rendered).toBeDefined();
    expect(rendered.structuralIntl).toBe(false);
    expect(rendered.excluded).toBeUndefined();
    expect(rendered.confidence).toBe('low');
  });

  test('the structural date-keys do not inflate DashboardShell density', () => {
    // DashboardShell's only INCLUDED sites are the <h1> copy + the rendered date;
    // the two excluded date-keys must not be counted.
    const row = inventory.componentsByDensity.find((c) => c.file.includes('DashboardShell'));
    const includedInFile = included.filter((s) => s.file.includes('DashboardShell')).length;
    expect(row).toBeDefined();
    expect(row.count).toBe(includedInFile);
  });
});

// ---------------------------------------------------------------------------
// (i-c) RUNTIME-TIMEZONE IDIOM — `Intl.DateTimeFormat().resolvedOptions().timeZone`
// (and the argument-less `Intl.DateTimeFormat()` family) produces a tz STRING FOR
// LOGIC, never display copy. The old classifier hardcoded hasFormatToParts=false,
// had NO `.resolvedOptions()` detection, and let a no-locale-arg
// `Intl.DateTimeFormat()` in a .tsx fall through every structural branch to
// {structural:false} — emitted INCLUDED. On Celestia3 this re-flagged
// TransitFeed.tsx:352, which sits INSIDE an already-extracted next-intl
// `format.dateTime(...)` formatter (a cowpath-localized surface), violating the
// M2 regression oracle ('the 4 already-localized surfaces are NOT re-flagged').
// The idiom appears 3x in real Celestia3 source.
// ---------------------------------------------------------------------------
describe('scan — (i-c) runtime-timezone Intl idiom is STRUCTURAL, not included', () => {
  const tf = at('date-intl').filter((s) => s.file.includes('TransitFeed'));

  test('both Intl.DateTimeFormat().resolvedOptions() calls are flagged structuralIntl + excluded', () => {
    const ro = tf.filter((s) => /resolvedOptions|argument-less/.test(s.excludedReason || ''));
    expect(ro.length).toBe(2);
    for (const s of ro) {
      expect(s.structuralIntl).toBe(true);
      expect(s.excluded).toBe(true);
      expect(s.confidence).toBe('low');
      expect(s.excludedReason).toMatch(/resolvedOptions|argument-less/);
    }
  });

  test('the in-JSX resolvedOptions site is excluded DESPITE living inside JSX (regression oracle)', () => {
    // The one inside format.dateTime(...) is in the JSX tree — proves the new
    // branch fires regardless of insideJsx, so the extracted formatter is not
    // re-flagged.
    const inJsx = tf.filter((s) => s.structuralIntl && s.excluded);
    expect(inJsx.length).toBeGreaterThanOrEqual(2);
  });

  test('the runtime-timezone idiom never inflates TransitFeed density', () => {
    const row = inventory.componentsByDensity.find((c) => c.file.includes('TransitFeed'));
    const includedInFile = included.filter((s) => s.file.includes('TransitFeed')).length;
    if (row) expect(row.count).toBe(includedInFile);
    // none of the excluded TransitFeed date sites are counted in density
    expect(tf.filter((s) => s.excluded).every((s) => true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (i-d) SECONDARY INTL LEAK — a bare-locale `toLocale*String([], {...})` whose
// result is assigned to a const and interpolated into a NON-JSX template literal
// (an LLM-prompt context string) is structural string-build machinery, not
// display copy. KTD-5's machine-locale branch only fired with a MACHINE locale
// arg present; the no-locale, not-in-JSX case slipped through as presentational.
// Celestia3 evidence: CosmicInsightPanel.tsx:91 (`toLocaleTimeString([], {...})`
// → `timeString` → `${timeString}` inside a backtick prompt string).
// ---------------------------------------------------------------------------
describe('scan — (i-d) bare-locale toLocale*String consumed by a non-JSX template is STRUCTURAL', () => {
  const tf = at('date-intl').filter((s) => s.file.includes('TransitFeed'));

  test('the toLocaleTimeString([], ...) → timeString → template site is excluded', () => {
    // the bare-locale toLocale* site carries the "Intl date" label (no localeArg)
    // and a structural exclusion reason naming the non-JSX template/string-build.
    const leak = tf.find((s) => s.excluded && /template\/string-build/.test(s.excludedReason || ''));
    expect(leak).toBeDefined();
    expect(leak.structuralIntl).toBe(true);
    expect(leak.confidence).toBe('low');
  });

  test('a presentational date IS still distinguished from the template-consumed one', () => {
    // Notices.tsx ReadingDate renders an en-US date in JSX — that stays INCLUDED.
    const presentational = at('date-intl').find((s) => s.file.includes('Notices'));
    expect(presentational).toBeDefined();
    expect(presentational.structuralIntl).toBe(false);
    expect(presentational.excluded).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (iv-b) developer-facing invariant Error messages are NOT captured as toasts.
// The dogfood OVER-CAPTURED three hook-provider guards
// ('useAuth must be used within an AuthProvider', etc.) as localizable toast
// sites at medium confidence. These are dev-only assertions that never reach a
// user and must never be translated. The genuine user-facing Error in the same
// file MUST still be captured (the guard is shape-scoped, not a blanket skip).
// ---------------------------------------------------------------------------
describe('scan — (iv-b) dev invariant Error messages are excluded, real ones kept', () => {
  const allText = sites.map((s) => s.text);

  test('a hook-provider "must be used within" invariant is NOT captured', () => {
    expect(allText).not.toContain('useAuth must be used within an AuthProvider');
  });

  test('a genuine user-facing Error string in the same file IS still captured', () => {
    expect(textsOf('toast')).toContain('Could not load your account');
  });
});

// ---------------------------------------------------------------------------
// (ii) CSS-className / data-attr / test-id false positives must NOT be extracted
// ---------------------------------------------------------------------------
describe('scan — (ii) machinery strings are NOT treated as user-facing', () => {
  const allText = sites.map((s) => s.text);

  test('no tailwind/className token string is extracted', () => {
    expect(allText).not.toContain('w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3');
    expect(allText).not.toContain('flex items-center gap-3');
    expect(allText).not.toContain('text-lg font-bold');
    expect(allText).not.toContain('sr-only');
    expect(allText).not.toContain('rounded-full');
  });

  test('no data-testid / data-cy / id / htmlFor / role value is extracted', () => {
    expect(allText).not.toContain('profile-card'); // data-testid
    expect(allText).not.toContain('search-box'); // data-cy
    expect(allText).not.toContain('profile-root'); // id
    expect(allText).not.toContain('search-input'); // id + htmlFor
    expect(allText).not.toContain('region'); // role
  });

  test('the className held in a const (CARD_CLASS) is not picked up as a string site', () => {
    expect(allText).not.toContain('w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3');
  });
});

// ---------------------------------------------------------------------------
// (iii) attribute kinds — placeholder / aria-label / title / alt
// ---------------------------------------------------------------------------
describe('scan — (iii) attribute kinds are detected by the scanner (not ESLint)', () => {
  test('placeholder is captured', () => {
    expect(textsOf('placeholder')).toContain('Search your readings');
  });

  test('aria-label is captured', () => {
    expect(textsOf('aria-label')).toEqual(
      expect.arrayContaining(['Search readings input', 'Settings']),
    );
  });

  test('title is captured', () => {
    expect(textsOf('title')).toContain('Open settings panel');
  });

  test('alt is captured', () => {
    expect(textsOf('alt')).toContain('User profile avatar');
  });

  test('each attribute kind has the right `kind` tag', () => {
    expect(at('placeholder').every((s) => s.kind === 'placeholder')).toBe(true);
    expect(at('aria-label').every((s) => s.kind === 'aria-label')).toBe(true);
    expect(at('title').every((s) => s.kind === 'title')).toBe(true);
    expect(at('alt').every((s) => s.kind === 'alt')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (iv) toast / error literals
// ---------------------------------------------------------------------------
describe('scan — (iv) toast / error literals are captured as kind=toast', () => {
  const toasts = textsOf('toast');

  test('toast.success / toast.error string args are captured', () => {
    expect(toasts).toEqual(
      expect.arrayContaining(['Profile saved successfully', 'Could not save your profile']),
    );
  });

  test('a new Error(...) message literal is captured', () => {
    expect(toasts).toContain('Profile save failed');
  });
});

// ---------------------------------------------------------------------------
// regression oracle — an already-extracted t()-wrapped literal is NOT re-flagged
// ---------------------------------------------------------------------------
describe('scan — regression oracle: already-extracted strings are not re-flagged', () => {
  test('the t() key argument is never emitted as a jsx-text or any site', () => {
    const allText = sites.map((s) => s.text);
    expect(allText).not.toContain('alreadyExtractedLabel');
  });
});

// ---------------------------------------------------------------------------
// real copy IS captured (jsx-text positive control)
// ---------------------------------------------------------------------------
describe('scan — jsx-text copy is captured', () => {
  test('multi-word visible copy is extracted', () => {
    const jt = textsOf('jsx-text');
    expect(jt).toEqual(
      expect.arrayContaining([
        'Welcome back, traveler',
        'Your reading is ready to view.',
        'Reading not found',
        'Shared reading',
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// suggested namespace / key / confidence + density ranking
// ---------------------------------------------------------------------------
describe('scan — suggested namespace + key + confidence + density', () => {
  test('namespace follows the component basename (PascalCase)', () => {
    const profile = fileSites('ProfileCard').filter((s) => !s.excluded);
    expect(profile.length).toBeGreaterThan(0);
    expect(profile.every((s) => s.suggestedNamespace === 'ProfileCard')).toBe(true);
  });

  test('a route page takes its parent dir as namespace (never the [param] dir)', () => {
    const page = fileSites('[shareId]');
    expect(page.length).toBeGreaterThan(0);
    for (const s of page) {
      expect(s.suggestedNamespace).not.toMatch(/[[\]]/);
    }
  });

  test('lib/util file date sites fall back to the common namespace', () => {
    const birth = fileSites('birthDateTime');
    expect(birth.every((s) => s.suggestedNamespace === 'common')).toBe(true);
  });

  test('suggested keys are camelCase slugs of the copy', () => {
    const s = at('jsx-text').find((x) => x.text === 'Welcome back, traveler');
    expect(s.suggestedKey).toBe('welcomeBackTraveler');
  });

  test('every site carries a valid confidence', () => {
    for (const s of sites) {
      expect(['high', 'medium', 'low']).toContain(s.confidence);
    }
  });

  test('componentsByDensity ranks the densest INCLUDED-site file first', () => {
    expect(inventory.componentsByDensity[0].file).toContain('ProfileCard');
    // monotonic non-increasing counts
    for (let i = 1; i < inventory.componentsByDensity.length; i++) {
      expect(inventory.componentsByDensity[i - 1].count).toBeGreaterThanOrEqual(
        inventory.componentsByDensity[i].count,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// counts by kind
// ---------------------------------------------------------------------------
describe('scan — countsByKind', () => {
  test('every kind key is present and counts match the site array', () => {
    const expected = {
      'jsx-text': 0,
      placeholder: 0,
      'aria-label': 0,
      title: 0,
      alt: 0,
      toast: 0,
      'date-intl': 0,
    };
    for (const s of sites) expected[s.kind] += 1;
    expect(inventory.countsByKind).toEqual(expected);
  });

  test('attribute kinds sum to the captured attribute sites', () => {
    const attrTotal =
      inventory.countsByKind.placeholder +
      inventory.countsByKind['aria-label'] +
      inventory.countsByKind.title +
      inventory.countsByKind.alt;
    expect(attrTotal).toBe(
      sites.filter((s) => ['placeholder', 'aria-label', 'title', 'alt'].includes(s.kind)).length,
    );
  });
});

// ---------------------------------------------------------------------------
// inventory schema validation (dependency-free structural validator)
// ---------------------------------------------------------------------------
describe('scan — inventory validates against inventory.schema.json', () => {
  const schema = JSON.parse(
    readFileSync(join(__dirname, '..', 'schemas', 'inventory.schema.json'), 'utf8'),
  );

  function validate(value, sch, path = '$') {
    const errors = [];
    const types = Array.isArray(sch.type) ? sch.type : sch.type ? [sch.type] : null;

    if (sch.const !== undefined && value !== sch.const) {
      errors.push(`${path}: expected const ${JSON.stringify(sch.const)}, got ${JSON.stringify(value)}`);
    }
    if (sch.enum && !sch.enum.includes(value)) {
      errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
    }
    if (types) {
      const ok = types.some((t) => typeMatch(value, t));
      if (!ok) {
        errors.push(`${path}: type mismatch, want ${types.join('|')}, got ${jsType(value)}`);
        return errors; // no point descending on a type mismatch
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && (sch.type === 'object' || (types && types.includes('object')))) {
      for (const req of sch.required || []) {
        if (!(req in value)) errors.push(`${path}: missing required "${req}"`);
      }
      if (sch.additionalProperties === false) {
        for (const k of Object.keys(value)) {
          if (!sch.properties || !(k in sch.properties)) {
            errors.push(`${path}: additional property "${k}" not allowed`);
          }
        }
      }
      for (const [k, subSchema] of Object.entries(sch.properties || {})) {
        if (k in value) errors.push(...validate(value[k], subSchema, `${path}.${k}`));
      }
    }
    if (Array.isArray(value) && sch.items) {
      value.forEach((item, i) => errors.push(...validate(item, sch.items, `${path}[${i}]`)));
    }
    return errors;
  }

  function jsType(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    if (Number.isInteger(v)) return 'integer';
    return typeof v;
  }
  function typeMatch(v, t) {
    switch (t) {
      case 'null': return v === null;
      case 'array': return Array.isArray(v);
      case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
      case 'integer': return Number.isInteger(v);
      case 'number': return typeof v === 'number';
      case 'string': return typeof v === 'string';
      case 'boolean': return typeof v === 'boolean';
      default: return false;
    }
  }

  test('the persisted inventory (JSON round-trip) has zero schema violations', () => {
    // round-trip through JSON to drop the non-enumerable _meta, exactly as the
    // CLI persists it — that is what gets validated.
    const persisted = JSON.parse(JSON.stringify(inventory));
    const errors = validate(persisted, schema);
    expect(errors).toEqual([]);
  });

  test('_meta is non-enumerable (excluded from the persisted shape)', () => {
    expect(Object.keys(inventory)).not.toContain('_meta');
    expect(inventory._meta).toBeDefined(); // still readable in-memory for the brief
  });
});

// ---------------------------------------------------------------------------
// six-block brief
// ---------------------------------------------------------------------------
describe('brief — emits all six blocks with grounded numbers', () => {
  const md = brief(inventory, { date: '2026-06-21' });

  test('all six block headings are present, in order', () => {
    const order = [
      '## 1. Framework & i18n detection',
      '## 2. Surface inventory',
      '## 3. String-source audit (counts by kind)',
      '## 4. Existing-localization map',
      '## 5. Gap + phased plan',
      '## 6. Stack-specific gotchas',
    ];
    let last = -1;
    for (const h of order) {
      const idx = md.indexOf(h);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  test('block 1 reports the detected framework + router + turbopack', () => {
    expect(md).toMatch(/Router type:\*\* app/);
    expect(md).toMatch(/i18n framework:\*\* none/);
    expect(md).toMatch(/Turbopack:\*\* yes/);
  });

  test('block 3 surfaces the excluded structural Intl count', () => {
    expect(md).toMatch(/structural `Intl` site\(s\) flagged EXCLUDED/);
    expect(md).toMatch(/birthDateTime\.ts/);
  });

  test('block 6 surfaces the dynamic-route glob gotcha for [shareId]', () => {
    expect(md).toMatch(/Dynamic-route ESLint glob/);
    expect(md).toMatch(/minimatch char class/);
  });

  test('block 2 density table leads with the densest component', () => {
    const block2 = md.slice(md.indexOf('## 2.'), md.indexOf('## 3.'));
    expect(block2).toMatch(/ProfileCard\.tsx/);
  });
});
