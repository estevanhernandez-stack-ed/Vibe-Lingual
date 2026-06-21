// M4 — audit engine tests.
//
// Asserts the gotcha rules + per-file readiness + decisions + phased plan on the
// audit-app fixture tree (docs/checklist.md M4). The fixture carries one instance
// of each gotcha type plus clean files, so every rule is exercised with a real
// positive AND the clean files prove no false positives:
//   - firebase-admin-ssr  : src/app/admin/page.tsx imports firebase-admin/firestore
//   - structural-intl     : src/utils/birthDateTime.ts (tz-offset math, excluded)
//   - timezone (decision) : src/components/EventList.tsx (presentational date)
//   - rtl                 : app-level INFO (always surfaced)
//   - dynamic-route-glob  : src/app/s/[shareId]/page.tsx
//   - clean files         : src/app/page.tsx, src/components/CleanCard.tsx (ready)
//   - dual-locale decision: src/lib/languages.ts (SUPPORTED_LANGUAGES + outputLanguage)
//   - html-lang decision  : src/app/layout.tsx (<html lang="en">)
//
// Plus the audit-schema validation (the persisted JSON validates) and the
// read-from-cached-inventory path the CLI uses.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detect } from '../engine/detect.mjs';
import { scan } from '../engine/scan.mjs';
import { audit } from '../engine/audit.mjs';
import { auditReport } from '../engine/audit-report.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP = join(__dirname, 'fixtures', 'audit-app');

const inventory = scan(APP, detect(APP));
const result = audit(inventory, APP);

const gotchasOf = (type) => result.gotchas.filter((g) => g.type === type);
const decisionOf = (id) => result.decisions.find((d) => d.id === id);
const readinessOf = (substr) => result.readiness.find((r) => r.file.includes(substr));
const phase = (name) => result.phasedPlan.find((p) => p.phase === name);

// ---------------------------------------------------------------------------
// gotcha rule 1 — firebase-admin in an SSR surface (BLOCK)
// ---------------------------------------------------------------------------
describe('audit — firebase-admin-ssr gotcha', () => {
  const fb = gotchasOf('firebase-admin-ssr');

  test('flags the admin page that imports firebase-admin as a BLOCK', () => {
    expect(fb.length).toBe(1);
    expect(fb[0].file).toBe('src/app/admin/page.tsx');
    expect(fb[0].severity).toBe('block');
    expect(fb[0].line).toBeGreaterThan(0);
    expect(fb[0].recommendation).toMatch(/firebase-admin/);
    expect(fb[0].recommendation).toMatch(/banned in Turbopack SSR|functions\//);
  });

  test('does NOT flag the clean layout / page / [shareId] SSR surfaces', () => {
    const files = fb.map((g) => g.file);
    expect(files).not.toContain('src/app/layout.tsx');
    expect(files).not.toContain('src/app/page.tsx');
    expect(files).not.toContain('src/app/s/[shareId]/page.tsx');
  });

  test('the firebase-admin file is marked BLOCKED in readiness', () => {
    const r = readinessOf('admin/page.tsx');
    expect(r).toBeDefined();
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/firebase-admin/);
  });

  test('skipping appRoot disables the source-dependent firebase rule (no false negative claim)', () => {
    // Without the app root, the firebase-admin source read is skipped — the rule
    // simply does not fire (it never guesses). Every OTHER rule still runs from
    // the inventory alone.
    const noRoot = audit(inventory);
    expect(noRoot.gotchas.filter((g) => g.type === 'firebase-admin-ssr')).toEqual([]);
    expect(noRoot.gotchas.filter((g) => g.type === 'dynamic-route-glob').length).toBe(1);
    expect(noRoot.gotchas.filter((g) => g.type === 'structural-intl').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// gotcha rule 2 — structural Intl confirm-before-extract (INFO)
// ---------------------------------------------------------------------------
describe('audit — structural-intl gotcha', () => {
  const si = gotchasOf('structural-intl');

  test('restates the scan-time birthDateTime.ts structural exclusion as an INFO gate', () => {
    expect(si.length).toBe(1);
    expect(si[0].file).toBe('src/utils/birthDateTime.ts');
    expect(si[0].severity).toBe('info');
    expect(si[0].recommendation).toMatch(/NOT display copy|corrupts the calculation/);
  });

  test('it carries the scan exclusion reason (the audit reads it from inventory)', () => {
    expect(si[0].recommendation).toMatch(/tz-offset math|locale-invariant/);
  });

  test('a structural-Intl-only file is not in the readiness work set', () => {
    // birthDateTime.ts has only excluded sites — no localization work — so it
    // must not appear as a ready/blocked file.
    expect(readinessOf('birthDateTime')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// gotcha rule 3 — timeZone is a REQUIRED decision, not auto-resolved (WARN + decision)
// ---------------------------------------------------------------------------
describe('audit — timezone gotcha + REQUIRED decision', () => {
  const tz = gotchasOf('timezone');

  test('flags the presentational date in EventList as a WARN (not excluded by scan)', () => {
    expect(tz.length).toBe(1);
    expect(tz[0].file).toBe('src/components/EventList.tsx');
    expect(tz[0].severity).toBe('warn');
    expect(tz[0].recommendation).toMatch(/do NOT auto-resolve/);
  });

  test('surfaces a timezone DECISION marked required:true (never auto-picked)', () => {
    const d = decisionOf('timezone');
    expect(d).toBeDefined();
    expect(d.required).toBe(true);
    expect(d.options.length).toBeGreaterThanOrEqual(2);
    expect(d.recommended).toMatch(/mixed|browser zone/);
  });

  test('the required-decision count reflects the timeZone choice', () => {
    expect(result.summary.requiredDecisions).toBe(1);
  });

  test('the structural birthDateTime sites do NOT trigger a timezone decision', () => {
    // only PRESENTATIONAL (included) date sites drive the timezone decision; the
    // excluded tz-math sites must not. EventList is the only presentational date.
    const presentationalDateFiles = result.gotchas
      .filter((g) => g.type === 'timezone')
      .map((g) => g.file);
    expect(presentationalDateFiles).toEqual(['src/components/EventList.tsx']);
  });
});

// ---------------------------------------------------------------------------
// gotcha rule 4 — RTL readiness (INFO, app-level)
// ---------------------------------------------------------------------------
describe('audit — rtl gotcha', () => {
  const rtl = gotchasOf('rtl');

  test('reports RTL absence as an app-level INFO', () => {
    expect(rtl.length).toBe(1);
    expect(rtl[0].severity).toBe('info');
    expect(rtl[0].file).toBeNull();
    expect(rtl[0].recommendation).toMatch(/Arabic|Hebrew|Urdu|LTR/);
  });
});

// ---------------------------------------------------------------------------
// gotcha rule 5 — dynamic-route ESLint glob (WARN)
// ---------------------------------------------------------------------------
describe('audit — dynamic-route-glob gotcha', () => {
  const dr = gotchasOf('dynamic-route-glob');

  test('flags the [shareId] dynamic route as a WARN', () => {
    expect(dr.length).toBe(1);
    expect(dr[0].file).toBe('src/app/s/[shareId]/page.tsx');
    expect(dr[0].severity).toBe('warn');
  });

  test('the recommendation gives the *-globbed path (never the literal [param])', () => {
    expect(dr[0].recommendation).toMatch(/src\/app\/s\/\*\/page\.tsx/);
    expect(dr[0].recommendation).toMatch(/minimatch char class/);
  });

  test('the dynamic-route file is BLOCKED in readiness (held until the glob is handled)', () => {
    const r = readinessOf('[shareId]');
    expect(r).toBeDefined();
    expect(r.status).toBe('blocked');
    expect(r.reason).toMatch(/glob|\[param\]/);
  });
});

// ---------------------------------------------------------------------------
// clean files — no false positives, marked READY
// ---------------------------------------------------------------------------
describe('audit — clean files are READY (no false-positive gotchas)', () => {
  test('CleanCard.tsx is ready (no firebase-admin, not a route, no presentational date)', () => {
    const r = readinessOf('CleanCard');
    expect(r).toBeDefined();
    expect(r.status).toBe('ready');
    expect(r.siteCount).toBeGreaterThan(0);
  });

  test('the clean home page is ready', () => {
    const r = readinessOf('app/page.tsx');
    expect(r).toBeDefined();
    expect(r.status).toBe('ready');
  });

  test('no gotcha targets a clean file', () => {
    const gotchaFiles = result.gotchas.map((g) => g.file).filter(Boolean);
    expect(gotchaFiles).not.toContain('src/components/CleanCard.tsx');
    expect(gotchaFiles).not.toContain('src/app/page.tsx');
    expect(gotchaFiles).not.toContain('src/app/layout.tsx');
  });
});

// ---------------------------------------------------------------------------
// decisions — dual-locale + html-lang surfaced from the inventory
// ---------------------------------------------------------------------------
describe('audit — surfaced decisions', () => {
  test('dual-locale decision fires because the app has an existing locale pref', () => {
    const d = decisionOf('dual-locale');
    expect(d).toBeDefined();
    expect(d.required).toBe(false);
    expect(d.question).toMatch(/outputLanguage/);
    expect(d.recommended).toMatch(/separate/);
  });

  test('html-lang decision fires because an App Router layout exists', () => {
    const d = decisionOf('html-lang');
    expect(d).toBeDefined();
    expect(d.question).toMatch(/layout\.tsx|lang=/);
  });

  test('decision ids are all within the schema enum', () => {
    const allowed = new Set(['timezone', 'dual-locale', 'html-lang']);
    for (const d of result.decisions) expect(allowed.has(d.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// readiness — blocked-first ordering, blocker count correct
// ---------------------------------------------------------------------------
describe('audit — readiness ordering + counts', () => {
  test('blocked files sort before ready files', () => {
    const statuses = result.readiness.map((r) => r.status);
    const firstReady = statuses.indexOf('ready');
    const lastBlocked = statuses.lastIndexOf('blocked');
    if (firstReady !== -1 && lastBlocked !== -1) {
      expect(lastBlocked).toBeLessThan(firstReady);
    }
  });

  test('summary blocked/ready counts match the readiness array', () => {
    expect(result.summary.filesBlocked).toBe(
      result.readiness.filter((r) => r.status === 'blocked').length,
    );
    expect(result.summary.filesReady).toBe(
      result.readiness.filter((r) => r.status === 'ready').length,
    );
    expect(result.summary.filesBlocked).toBe(2); // admin + [shareId]
  });
});

// ---------------------------------------------------------------------------
// phased plan — extract → wire → translate → wire-to-locale → guard, grounded
// ---------------------------------------------------------------------------
describe('audit — phased plan', () => {
  test('all five phases are present, in order', () => {
    expect(result.phasedPlan.map((p) => p.phase)).toEqual([
      'extract',
      'wire',
      'translate',
      'wire-to-locale',
      'guard',
    ]);
  });

  test('extract phase names the blocker count + the structural skip', () => {
    const e = phase('extract');
    expect(e.items.join(' ')).toMatch(/BLOCKED by firebase-admin/);
    expect(e.items.join(' ')).toMatch(/structural `Intl`/);
  });

  test('translate phase reuses the existing SUPPORTED_LANGUAGES list', () => {
    const t = phase('translate');
    expect(t.items.join(' ')).toMatch(/SUPPORTED_LANGUAGES/);
  });

  test('guard phase emits the *-globbed dynamic-route guard + the parity test', () => {
    const g = phase('guard');
    expect(g.items.join(' ')).toMatch(/src\/app\/s\/\*\/page\.tsx/);
    expect(g.items.join(' ')).toMatch(/parity test/);
    expect(g.items.join(' ')).toMatch(/jsx-no-literals/);
  });

  test('wire phase warns off mounting the loader in the firebase-admin file', () => {
    const w = phase('wire');
    expect(w.items.join(' ')).toMatch(/Do NOT mount the locale loader in `src\/app\/admin\/page\.tsx`/);
  });
});

// ---------------------------------------------------------------------------
// summary totals
// ---------------------------------------------------------------------------
describe('audit — summary', () => {
  test('gotcha severity counts sum to the total', () => {
    const s = result.summary;
    expect(s.blockers + s.warnings + s.infos).toBe(s.totalGotchas);
    expect(s.totalGotchas).toBe(result.gotchas.length);
  });

  test('one blocker, two warns, two infos on this fixture', () => {
    expect(result.summary.blockers).toBe(1);
    expect(result.summary.warnings).toBe(2);
    expect(result.summary.infos).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// read-from-cached-inventory — the CLI's --inventory path
// ---------------------------------------------------------------------------
describe('audit — runs from a cached inventory (no re-scan)', () => {
  test('a JSON round-tripped inventory produces the same gotcha set', () => {
    // simulate the CLI reading .vibe-lingual/state/inventory.json off disk.
    const cached = JSON.parse(JSON.stringify(inventory));
    const fromCache = audit(cached, APP);
    expect(fromCache.gotchas.map((g) => g.type).sort()).toEqual(
      result.gotchas.map((g) => g.type).sort(),
    );
    expect(fromCache.summary).toEqual(result.summary);
  });
});

// ---------------------------------------------------------------------------
// audit report — markdown renders all sections
// ---------------------------------------------------------------------------
describe('audit report — markdown', () => {
  const md = auditReport(result, { root: 'audit-app', date: '2026-06-21' });

  test('renders the four sections in order', () => {
    const order = ['## Gotchas', '## Decisions to make', '## Per-file readiness', '## Phased plan'];
    let last = -1;
    for (const h of order) {
      const idx = md.indexOf(h);
      expect(idx).toBeGreaterThan(last);
      last = idx;
    }
  });

  test('the required timeZone decision is rendered REQUIRED', () => {
    expect(md).toMatch(/`timezone` \(\*\*REQUIRED\*\*\)/);
  });

  test('the firebase-admin blocker appears under BLOCK', () => {
    expect(md).toMatch(/### BLOCK/);
    expect(md).toMatch(/src\/app\/admin\/page\.tsx/);
  });

  test('the readiness table flags the blocked files', () => {
    expect(md).toMatch(/\*\*BLOCKED\*\*/);
  });
});

// ---------------------------------------------------------------------------
// audit schema validation — the persisted JSON validates (dependency-free)
// ---------------------------------------------------------------------------
describe('audit — validates against audit.schema.json', () => {
  const schema = JSON.parse(
    readFileSync(join(__dirname, '..', 'schemas', 'audit.schema.json'), 'utf8'),
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
        return errors;
      }
    }
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (sch.type === 'object' || (types && types.includes('object')))
    ) {
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
    if (Array.isArray(value)) {
      if (typeof sch.minItems === 'number' && value.length < sch.minItems) {
        errors.push(`${path}: expected at least ${sch.minItems} item(s), got ${value.length}`);
      }
      if (sch.items) {
        value.forEach((item, i) => errors.push(...validate(item, sch.items, `${path}[${i}]`)));
      }
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

  test('the persisted audit (JSON round-trip) has zero schema violations', () => {
    const persisted = JSON.parse(JSON.stringify(result));
    const errors = validate(persisted, schema);
    expect(errors).toEqual([]);
  });
});
