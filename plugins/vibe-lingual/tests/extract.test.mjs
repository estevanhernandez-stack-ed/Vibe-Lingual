// M8 — extract loop tests. The WRITE side of localize.
//
// Asserts the three KTD-2 contracts on isolated temp app trees:
//   1. CONFIDENCE ROUTING — a high-confidence file auto-writes (source rewritten +
//      catalog merged + backed up); a low-confidence file routes inline-only (no
//      write); a medium file STAGES to .vibe-lingual/localize/staged/ (live source
//      untouched). A blocked file (audit readiness) NEVER auto-writes regardless
//      of confidence.
//   2. ATOMIC + NEVER-LOSE-A-CATALOG — mergeCatalog preserves existing keys, adds
//      new ones, and never clobbers a human-edited translation.
//   3. IDEMPOTENT / RESUMABLE — a second run over the same inventory writes nothing
//      new (the ledger + the codemod's changed:false both gate it).
//
// Fixtures are built from scratch per test so confidence is controllable: scan's
// site-confidence is kind+length driven (short jsx-text → high; date-intl → low).

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detect } from '../engine/detect.mjs';
import { scan } from '../engine/scan.mjs';
import { audit } from '../engine/audit.mjs';
import {
  extract,
  mergeCatalog,
  fileConfidence,
  fileRouteTier,
  partitionSitesByConfidence,
  promoteStaged,
} from '../engine/extract.mjs';
import { rollback } from '../engine/backup.mjs';
import { parse } from '@babel/parser';

// Parse the emitted source the same way the scanner does — proves a per-site
// partial extraction produces VALID syntax (a half-rewritten literal would throw).
function parsesClean(source) {
  try {
    parse(source, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
    });
    return true;
  } catch {
    return false;
  }
}

function tmpApp() {
  const root = mkdtempSync(join(tmpdir(), 'vl-extract-'));
  mkdirSync(join(root, 'src', 'components'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }), 'utf8');
  return root;
}

function write(root, rel, contents) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), contents, 'utf8');
}

// a high-confidence client component: short JSX text (≤60 chars, no braces) → high.
const HIGH_CONF_CLIENT = `"use client";
import React from 'react';

export default function Greeting() {
  return (
    <div className="wrap">
      <h1>Welcome back</h1>
      <p>Choose your destiny</p>
    </div>
  );
}
`;

// a low-confidence file: a presentational display date → scan rates date-intl low.
// NO machine-locale arg (a fixed 'en-US'/'en-CA' would read as tz-offset math and
// the codemod would skip it as structural); a bare toLocaleDateString is a real
// display site the codemod CAN rewrite — so the routing decision, not a codemod
// no-op, is what holds the file back to inline-only.
const LOW_CONF_DATE = `"use client";
import React from 'react';

export default function TransitFeed({ date }) {
  return (
    <div>
      <span>{date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</span>
    </div>
  );
}
`;

describe('confidence routing — high auto-writes', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a high-confidence file is rewritten + catalog merged + backed up', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });

    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.confidence).toBe('high');
    expect(r.route).toBe('auto-write');
    expect(r.status).toBe('written');

    // source actually rewritten
    const src = readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8');
    expect(src).toContain("const t = useTranslations('Greeting')");
    expect(src).toContain("{t('welcomeBack')}");

    // catalog written + keys present
    const cat = JSON.parse(readFileSync(join(root, 'messages/en/Greeting.json'), 'utf8'));
    expect(cat).toMatchObject({ welcomeBack: 'Welcome back', chooseYourDestiny: 'Choose your destiny' });

    // backed up — a batch with a manifest exists
    expect(report.batchId).toBeTruthy();
    expect(existsSync(join(root, r.backupPath))).toBe(true);
  });
});

describe('confidence routing — low routes inline-only (no write)', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/TransitFeed.tsx', LOW_CONF_DATE);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a low-confidence date file is suggested, not written', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });

    const r = report.results.find((x) => x.file === 'src/components/TransitFeed.tsx');
    expect(r.confidence).toBe('low');
    expect(r.route).toBe('inline-only');
    expect(r.status).toBe('inline-only');

    // source UNTOUCHED — no useFormatter injected
    const src = readFileSync(join(root, 'src/components/TransitFeed.tsx'), 'utf8');
    expect(src).not.toContain('useFormatter');
    // no catalog written
    expect(existsSync(join(root, 'messages/en/TransitFeed.json'))).toBe(false);
    // no backup batch (nothing written)
    expect(report.batchId).toBeNull();
  });
});

describe('confidence routing — medium STAGES (live source untouched)', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Card.tsx', HIGH_CONF_CLIENT.replace('Greeting', 'Card'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a medium-confidence file mirrors the rewrite to staged/, leaving source intact', () => {
    const inv = scan(root, detect(root));
    // force the file to medium by injecting a medium-confidence site flag
    for (const s of inv.sites) s.confidence = 'medium';

    const report = extract(inv, { appRoot: root });
    const r = report.results.find((x) => x.file === 'src/components/Card.tsx');
    expect(r.confidence).toBe('medium');
    expect(r.route).toBe('stage');
    expect(r.status).toBe('staged');

    // live source untouched
    const src = readFileSync(join(root, 'src/components/Card.tsx'), 'utf8');
    expect(src).not.toContain('useTranslations');

    // staged mirror + staged catalog written
    expect(existsSync(join(root, '.vibe-lingual/localize/staged/src/components/Card.tsx'))).toBe(true);
    const stagedCat = JSON.parse(
      readFileSync(join(root, '.vibe-lingual/localize/staged/messages/en/Card.json'), 'utf8'),
    );
    expect(Object.keys(stagedCat).length).toBeGreaterThan(0);
  });
});

describe('confidence routing — blocked never auto-writes', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    // an SSR page that imports firebase-admin → audit marks it blocked
    mkdirSync(join(root, 'src', 'app', 'admin'), { recursive: true });
    write(
      root,
      'src/app/admin/page.tsx',
      `import { getFirestore } from 'firebase-admin/firestore';
export default async function AdminPage() {
  return <main><h1>Admin panel</h1></main>;
}
`,
    );
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a firebase-admin SSR file routes inline-only even at high confidence', () => {
    const inv = scan(root, detect(root));
    const auditObj = audit(inv, root);
    const report = extract(inv, { appRoot: root, audit: auditObj });

    const r = report.results.find((x) => x.file === 'src/app/admin/page.tsx');
    expect(r.status).toBe('blocked');
    expect(r.route).toBe('inline-only');
    expect(r.reason).toMatch(/firebase-admin/);

    // source untouched, no catalog, no backup
    const src = readFileSync(join(root, 'src/app/admin/page.tsx'), 'utf8');
    expect(src).not.toContain('getTranslations');
    expect(report.batchId).toBeNull();
  });
});

describe('atomic catalog merge — never lose a key', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('mergeCatalog preserves existing keys + adds new ones', () => {
    const cat = join(root, 'messages/en/Common.json');
    mkdirSync(join(root, 'messages/en'), { recursive: true });
    writeFileSync(cat, JSON.stringify({ hello: 'Hi', bye: 'Bye' }, null, 2), 'utf8');

    const res = mergeCatalog(cat, { hello: 'IGNORED', greeting: 'Hello there' });
    expect(res.added).toBe(1); // greeting
    expect(res.kept).toBe(1); // hello (existing wins by default)

    const merged = JSON.parse(readFileSync(cat, 'utf8'));
    expect(merged.hello).toBe('Hi'); // human edit preserved, NOT clobbered
    expect(merged.bye).toBe('Bye'); // untouched key survives
    expect(merged.greeting).toBe('Hello there'); // new key added
  });

  test('mergeCatalog overwrite:true replaces existing values', () => {
    const cat = join(root, 'messages/en/Common.json');
    mkdirSync(join(root, 'messages/en'), { recursive: true });
    writeFileSync(cat, JSON.stringify({ hello: 'Hi' }), 'utf8');
    mergeCatalog(cat, { hello: 'Hiya' }, { overwrite: true });
    expect(JSON.parse(readFileSync(cat, 'utf8')).hello).toBe('Hiya');
  });

  test('extract merges into an existing catalog without losing prior keys', () => {
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
    // a pre-existing Greeting catalog with a human-added key
    mkdirSync(join(root, 'messages/en'), { recursive: true });
    writeFileSync(
      join(root, 'messages/en/Greeting.json'),
      JSON.stringify({ manualKey: 'Hand-written' }, null, 2),
      'utf8',
    );

    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });

    const cat = JSON.parse(readFileSync(join(root, 'messages/en/Greeting.json'), 'utf8'));
    expect(cat.manualKey).toBe('Hand-written'); // prior key survives the extract
    expect(cat.welcomeBack).toBe('Welcome back'); // new extracted key added
  });
});

describe('idempotency / resumability — a second run converges', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('the second run writes nothing new (ledger + codemod no-op both gate it)', () => {
    const inv = scan(root, detect(root));

    const first = extract(inv, { appRoot: root });
    expect(first.summary.written).toBe(1);

    // re-scan the now-extracted tree (resumable real-world flow) + re-run
    const inv2 = scan(root, detect(root));
    const second = extract(inv2, { appRoot: root });

    // nothing written on the second pass — converged. A fully-extracted file may
    // either be SKIPPED (still in the inventory, codemod no-op / ledger-done) or
    // DROP OUT of the inventory entirely (re-scan finds zero included sites once
    // every literal is a t() call). Both are valid convergence; what matters is
    // zero new writes.
    expect(second.summary.written).toBe(0);
    const r = second.results.find((x) => x.file === 'src/components/Greeting.tsx');
    if (r) {
      expect(['skipped-done', 'skipped-no-change']).toContain(r.status);
    }
  });

  test('dry-run plans without writing, leaving source + catalog untouched', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root, dryRun: true });

    expect(report.dryRun).toBe(true);
    expect(report.batchId).toBeNull();
    // source unchanged
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).toBe(HIGH_CONF_CLIENT);
    // no catalog
    expect(existsSync(join(root, 'messages/en/Greeting.json'))).toBe(false);
  });
});

describe('fileConfidence — most-cautious aggregation', () => {
  test('one low site pulls a file to low', () => {
    expect(fileConfidence([{ confidence: 'high' }, { confidence: 'low' }])).toBe('low');
  });
  test('all-high stays high', () => {
    expect(fileConfidence([{ confidence: 'high' }, { confidence: 'high' }])).toBe('high');
  });
  test('high + medium → medium', () => {
    expect(fileConfidence([{ confidence: 'high' }, { confidence: 'medium' }])).toBe('medium');
  });
  test('empty → low', () => {
    expect(fileConfidence([])).toBe('low');
  });
});

// BUG-3 routing primitives. The OLD model (fileConfidence, worst-wins) sank a
// heavy file by its single worst site; the NEW model (fileRouteTier, best-wins +
// partition) lets the high sites extract while the low sites stay inline.
describe('fileRouteTier — highest-tier wins (the BUG-3 inverse of fileConfidence)', () => {
  test('any high site routes the file high (even with a low sibling)', () => {
    expect(fileRouteTier([{ confidence: 'high' }, { confidence: 'low' }])).toBe('high');
  });
  test('no high but a medium routes medium', () => {
    expect(fileRouteTier([{ confidence: 'medium' }, { confidence: 'low' }])).toBe('medium');
  });
  test('all-low routes low', () => {
    expect(fileRouteTier([{ confidence: 'low' }, { confidence: 'low' }])).toBe('low');
  });
  test('empty → low', () => {
    expect(fileRouteTier([])).toBe('low');
  });
});

describe('partitionSitesByConfidence — bucket sites by tier', () => {
  test('splits into high/medium/low, unknown confidence defaults to low', () => {
    const b = partitionSitesByConfidence([
      { confidence: 'high', line: 1 },
      { confidence: 'high', line: 2 },
      { confidence: 'medium', line: 3 },
      { confidence: 'low', line: 4 },
      { confidence: undefined, line: 5 },
    ]);
    expect(b.high.map((s) => s.line)).toEqual([1, 2]);
    expect(b.medium.map((s) => s.line)).toEqual([3]);
    expect(b.low.map((s) => s.line)).toEqual([4, 5]); // undefined → low
  });
});

// THE BUG-3 TARGET. A heavy mixed file: 10 clean high jsx-text sites + 1 date-intl
// (low) + 1 long-interpolated jsx-text (low). The OLD worst-wins routing sank the
// whole file to inline-only (extracted NOTHING — the 13-heavy-component frontier).
// The NEW per-site routing extracts the 10 high sites to t(), leaves the 2 low
// sites inline as literals, parses clean, and is idempotent on re-run.
const HEAVY_MIXED = `"use client";
import React from 'react';

export default function Dashboard({ when, name }) {
  return (
    <div className="wrap">
      <h1>Welcome home</h1>
      <p>Your cosmic dashboard</p>
      <span>Today at a glance</span>
      <button>Open settings</button>
      <a>View your chart</a>
      <h2>Recent transits</h2>
      <p>Daily horoscope</p>
      <span>Moon phase tonight</span>
      <button>Refresh now</button>
      <h3>Saved readings</h3>
      <time>{when.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}</time>
      <p>This is a deliberately very long single interpolated narrative line, well past the high-confidence length floor, so the scanner rates it low and the per-site router must leave it inline as a literal rather than wrapping it in a t call {name}</p>
    </div>
  );
}
`;

describe('BUG-3 — per-SITE routing extracts a heavy mixed file partially', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Dashboard.tsx', HEAVY_MIXED);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('the 10 high sites extract; the date + long-interpolated low sites stay inline', () => {
    const inv = scan(root, detect(root));

    // sanity on the fixture: 10 high jsx-text + 1 date-intl(low) + 1 long jsx-text(low).
    const forFile = inv.sites.filter((s) => s.file === 'src/components/Dashboard.tsx' && !s.excluded);
    const highs = forFile.filter((s) => s.confidence === 'high');
    const lows = forFile.filter((s) => s.confidence === 'low');
    expect(highs).toHaveLength(10);
    expect(lows).toHaveLength(2); // the date-intl + the long interpolated line

    const report = extract(inv, { appRoot: root });
    const r = report.results.find((x) => x.file === 'src/components/Dashboard.tsx');

    // the OLD behavior would be route:inline-only, status:inline-only (worst-wins).
    // the NEW behavior: the file auto-writes its HIGH sites — partial extraction.
    expect(r.route).toBe('auto-write');
    expect(r.status).toBe('written');
    expect(r.sitesWritten).toBe(10);
    expect(r.sitesInline).toBe(2);
    expect(r.fullyExtracted).toBe(false); // 2 sites left inline → NOT fully extracted

    const src = readFileSync(join(root, 'src/components/Dashboard.tsx'), 'utf8');
    // the 10 high sites are now t() calls.
    expect(src).toContain("const t = useTranslations('Dashboard')");
    for (const key of [
      'welcomeHome',
      'yourCosmicDashboard',
      'todayAtAGlance',
      'openSettings',
      'viewYourChart',
      'recentTransits',
      'dailyHoroscope',
      'moonPhaseTonight',
      'refreshNow',
      'savedReadings',
    ]) {
      expect(src).toContain(`t('${key}')`);
    }
    // the 2 LOW sites stay inline literals — never wrapped.
    expect(src).toContain('when.toLocaleDateString(undefined,'); // date-intl untouched
    expect(src).not.toContain('format.dateTime'); // never rewritten to a formatter
    expect(src).toContain('This is a deliberately very long single interpolated narrative line'); // long line inline
    // exactly 10 t() call sites land in the catalog.
    expect(Object.keys(r.keys)).toHaveLength(10);
  });

  test('the partial output parses clean (no half-rewritten literal)', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });
    const src = readFileSync(join(root, 'src/components/Dashboard.tsx'), 'utf8');
    expect(parsesClean(src)).toBe(true);
  });

  test('a partial extraction is NOT ratchetable (guard never flips a file that keeps literals)', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    // the guard's input list excludes this file — it still holds literals.
    expect(report.summary.ratchetableFiles).not.toContain('src/components/Dashboard.tsx');
    expect(report.summary.partial).toBe(1);
    expect(report.summary.sitesInline).toBe(2);
    // ledger records the partial state so a resumed run + the guard both know.
    const ledger = JSON.parse(
      readFileSync(join(root, '.vibe-lingual/localize/state/extract-ledger.json'), 'utf8'),
    );
    expect(ledger.files['src/components/Dashboard.tsx'].fullyExtracted).toBe(false);
  });

  test('re-running over the now-partial tree writes nothing new (idempotent)', () => {
    const inv = scan(root, detect(root));
    const first = extract(inv, { appRoot: root });
    expect(first.summary.written).toBe(1);
    expect(first.summary.partial).toBe(1);

    // re-scan the partially-extracted tree + re-run. The 10 high sites are already
    // t() calls (scan won't re-flag them); only the 2 low sites remain, and they
    // route inline-only — so zero new writes. Converged.
    const inv2 = scan(root, detect(root));
    const second = extract(inv2, { appRoot: root });
    expect(second.summary.written).toBe(0);
    const r2 = second.results.find((x) => x.file === 'src/components/Dashboard.tsx');
    if (r2) {
      // the file still has its 2 low sites → it routes inline-only now (no high left).
      expect(['inline-only', 'skipped-done', 'skipped-no-change']).toContain(r2.status);
    }
    // source unchanged on the second pass — the high sites stay extracted, low inline.
    const src = readFileSync(join(root, 'src/components/Dashboard.tsx'), 'utf8');
    expect(src).toContain("t('welcomeHome')");
    expect(src).toContain('This is a deliberately very long single interpolated narrative line');
    expect(parsesClean(src)).toBe(true);
  });

  test('a fully-high file (no low sites) STILL fully extracts + IS ratchetable (no regression)', () => {
    // the all-high control: no inline sites → fullyExtracted true → ratchetable.
    write(root, 'src/components/Clean.tsx', HIGH_CONF_CLIENT.replace('Greeting', 'Clean'));
    rmSync(join(root, 'src/components/Dashboard.tsx'));
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    const r = report.results.find((x) => x.file === 'src/components/Clean.tsx');
    expect(r.status).toBe('written');
    expect(r.fullyExtracted).toBe(true);
    expect(r.sitesInline).toBe(0);
    expect(report.summary.ratchetableFiles).toContain('src/components/Clean.tsx');
  });

  test('a force-staged heavy file stages its high sites + the partial flag survives promotion', () => {
    const inv = scan(root, detect(root));
    const staged = extract(inv, { appRoot: root, stageAll: true });
    const sr = staged.results.find((x) => x.file === 'src/components/Dashboard.tsx');
    // force-stage demotes the auto-write to stage but still only the high sites.
    expect(sr.status).toBe('staged');
    expect(sr.sitesWritten).toBe(10);
    expect(sr.sitesInline).toBe(2);
    expect(sr.fullyExtracted).toBe(false);

    // promote: the partial flag carries, the live source gets the high sites, the
    // low sites stay inline — a promoted partial is NOT ratchetable.
    const promoted = promoteStaged(root, 'src/components/Dashboard.tsx');
    expect(promoted.ok).toBe(true);
    expect(promoted.fullyExtracted).toBe(false);
    const live = readFileSync(join(root, 'src/components/Dashboard.tsx'), 'utf8');
    expect(live).toContain("t('welcomeHome')"); // high extracted
    expect(live).toContain('when.toLocaleDateString(undefined,'); // date inline
    expect(parsesClean(live)).toBe(true);
  });
});

// the co-located test a touched component carries. After the component grows a
// next-intl hook, this test needs the <NextIntlClientProvider> wrapper or it goes
// red. The extract loop must discover it, surface it, back it up, and wrap it.
const CO_LOCATED_TEST = `import { render, screen } from '@testing-library/react';
import Greeting from './Greeting';

test('renders the greeting', () => {
  render(<Greeting />);
});
`;

describe('test-harness collateral — discover + back up + wrap (M8 AC)', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
    write(root, 'src/components/Greeting.test.tsx', CO_LOCATED_TEST);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('an auto-written component surfaces its co-located test in the result + summary', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });

    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.status).toBe('written');
    // the test is DISCOVERED and surfaced — the SKILL cannot silently leave the suite red.
    expect(r.collateralTests).toEqual(['src/components/Greeting.test.tsx']);
    expect(report.summary.collateralTests).toBe(1);
    expect(report.summary.collateralTestsWrapped).toBe(1);
  });

  test('the co-located test enters the SAME backup batch (rollback coherence)', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });

    const manifest = JSON.parse(
      readFileSync(join(root, '.vibe-lingual/localize/backup', report.batchId, 'manifest.json'), 'utf8'),
    );
    const sources = manifest.files.map((f) => f.source);
    expect(sources).toContain('src/components/Greeting.tsx');
    // THE FIX: the test is in the batch, not outside it.
    expect(sources).toContain('src/components/Greeting.test.tsx');
  });

  test('the co-located test is provider-wrapped as part of the extract output', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });

    const testNow = readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8');
    expect(testNow).toContain('NextIntlClientProvider');
    expect(testNow).toContain("import { NextIntlClientProvider } from 'next-intl';");
  });

  test('rollback restores BOTH component and test byte-for-byte (consistency hole closed)', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });

    // sanity: both were mutated
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).not.toBe(HIGH_CONF_CLIENT);
    expect(readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8')).not.toBe(CO_LOCATED_TEST);

    const rb = rollback(root, report.batchId);
    expect(rb.ok).toBe(true);
    expect(rb.restored).toContain('src/components/Greeting.test.tsx');

    // both back to their EXACT original bytes — no half-localized repo state.
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).toBe(HIGH_CONF_CLIENT);
    expect(readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8')).toBe(CO_LOCATED_TEST);
  });

  test('a component with no co-located test reports an empty collateral list (no false flag)', () => {
    rmSync(join(root, 'src/components/Greeting.test.tsx'));
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.collateralTests).toEqual([]);
    expect(report.summary.collateralTests).toBe(0);
  });
});

// THE MULTI-RENDER BUG (M8 safety-claim failure). The dominant React Testing
// Library pattern is one render() per test() block, so a real test file has N
// render(<Component/>) calls. A regex pass with a NON-global match rewrote only the
// FIRST and left the other N-1 BARE — each bare render of the now-i18n'd component
// throws `No intl context found` at test time → the app's own suite goes RED after
// an auto-write, while the engine reported `collateralTestsWrapped: 1,
// collateralTestsNeedManualWrap: 0` (a green banner over a red suite). The AST wrap
// must touch EVERY render call, and any render it CANNOT wrap (a non-JSX arg) must
// flow into collateralTestsNeedManualWrap so the banner warns.
const MULTI_RENDER_TEST = `import { render, screen } from '@testing-library/react';
import Greeting from './Greeting';

test('renders the greeting', () => {
  render(<Greeting />);
  expect(screen.getByText('Welcome back')).toBeTruthy();
});

test('renders with a name', () => {
  render(<Greeting name="Este" />);
});

test('renders the empty state', () => {
  render(<Greeting empty />);
});
`;

describe('test-harness collateral — EVERY render() call wrapped (multi-render fix)', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
    write(root, 'src/components/Greeting.test.tsx', MULTI_RENDER_TEST);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('all THREE render calls get the provider — not just the first (the regression)', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });

    const testNow = readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8');
    // exactly three NextIntlClientProvider OPEN tags — one per render call. Counting
    // open tags (not bare occurrences) so the import line doesn't inflate the count.
    const openTags = (testNow.match(/<NextIntlClientProvider/g) || []).length;
    expect(openTags).toBe(3);
    // and NO bare render(<Greeting — every render's first arg is now the provider.
    expect(/render\(\s*<Greeting/.test(testNow)).toBe(false);
  });

  test('the summary reports all three wrapped, zero needing a manual wrap', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    // PER-RENDER-CALL accounting: 3 calls wrapped, not "1 file wrapped".
    expect(report.summary.collateralTestsWrapped).toBe(3);
    expect(report.summary.collateralTestsNeedManualWrap).toBe(0);
  });

  test('the wrapped suite no longer leaves a bare render (the live-red scenario)', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });
    const testNow = readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8');
    // the import is present exactly once
    expect((testNow.match(/import \{ NextIntlClientProvider \}/g) || []).length).toBe(1);
    // the non-render assertion line is preserved untouched (recast keeps it)
    expect(testNow).toContain("expect(screen.getByText('Welcome back')).toBeTruthy()");
  });

  test('rollback restores the multi-render test byte-for-byte', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    expect(readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8')).not.toBe(MULTI_RENDER_TEST);
    const rb = rollback(root, report.batchId);
    expect(rb.ok).toBe(true);
    expect(readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8')).toBe(MULTI_RENDER_TEST);
  });
});

// A render() call whose first argument is NOT JSX (render(ui), render(buildUI()))
// cannot be wrapped as JSX without breaking it. The engine must leave it as-is AND
// count it into collateralTestsNeedManualWrap so the banner warns — never silently
// claim a fully-wrapped suite when a render was left bare.
const MIXED_RENDER_TEST = `import { render, screen } from '@testing-library/react';
import Greeting from './Greeting';

test('direct render', () => {
  render(<Greeting />);
});

test('indirect render', () => {
  const ui = <Greeting />;
  render(ui);
});
`;

describe('test-harness collateral — non-JSX render args are flagged for a manual wrap', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
    write(root, 'src/components/Greeting.test.tsx', MIXED_RENDER_TEST);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('the JSX render wraps, the variable render is counted as needing a manual wrap', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });

    // file IS changed (one render wrapped) but the summary STILL warns about the
    // unwrappable one — the green-over-red failure mode is closed.
    expect(report.summary.collateralTestsWrapped).toBe(1);
    expect(report.summary.collateralTestsNeedManualWrap).toBe(1);

    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    const edit = r.testEdits.find((t) => t.file === 'src/components/Greeting.test.tsx');
    expect(edit.wrappedCount).toBe(1);
    expect(edit.needsManualWrap).toBe(1);
    expect(edit.reason).toMatch(/non-JSX argument/);

    // the variable render was left intact (not corrupted)
    const testNow = readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8');
    expect(testNow).toContain('render(ui)');
  });
});

describe('--stage-all — force every file to staging regardless of confidence', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a high-confidence file STAGES (not auto-writes) under stageAll', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root, stageAll: true });

    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.confidence).toBe('high');
    expect(r.route).toBe('stage');
    expect(r.status).toBe('staged');
    expect(r.reason).toMatch(/force-staged/);

    // live source UNTOUCHED — the whole point of the cautious first pass.
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).toBe(HIGH_CONF_CLIENT);
    // no live catalog, no backup batch (nothing was auto-written)
    expect(existsSync(join(root, 'messages/en/Greeting.json'))).toBe(false);
    expect(report.batchId).toBeNull();
    // staged mirror + staged manifest exist
    expect(existsSync(join(root, '.vibe-lingual/localize/staged/src/components/Greeting.tsx'))).toBe(true);
    expect(existsSync(join(root, report.stagedManifestPath))).toBe(true);
  });

  test('stageAll never PROMOTES a low file (it only demotes auto-write)', () => {
    rmSync(join(root, 'src/components/Greeting.tsx'));
    write(root, 'src/components/TransitFeed.tsx', LOW_CONF_DATE);
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root, stageAll: true });
    const r = report.results.find((x) => x.file === 'src/components/TransitFeed.tsx');
    // a low file stays inline-only — force-stage demotes, it does not upgrade.
    expect(r.status).toBe('inline-only');
  });

  test('stageAll does NOT override a blocked file (audit gate still wins)', () => {
    rmSync(join(root, 'src/components/Greeting.tsx'));
    mkdirSync(join(root, 'src', 'app', 'admin'), { recursive: true });
    write(
      root,
      'src/app/admin/page.tsx',
      `import { getFirestore } from 'firebase-admin/firestore';
export default async function AdminPage() {
  return <main><h1>Admin panel</h1></main>;
}
`,
    );
    const inv = scan(root, detect(root));
    const auditObj = audit(inv, root);
    const report = extract(inv, { appRoot: root, audit: auditObj, stageAll: true });
    const r = report.results.find((x) => x.file === 'src/app/admin/page.tsx');
    expect(r.status).toBe('blocked');
  });
});

describe('--apply-staged — promote a staged rewrite to live source', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
    write(root, 'src/components/Greeting.test.tsx', CO_LOCATED_TEST);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('promoteStaged writes the live source, merges the catalog, and wraps the test', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root, stageAll: true }); // stage first

    // live source still untouched after staging
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).toBe(HIGH_CONF_CLIENT);

    const res = promoteStaged(root, 'src/components/Greeting.tsx');
    expect(res.ok).toBe(true);
    expect(res.batchId).toBeTruthy();

    // live source now extracted, live catalog written
    const live = readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8');
    expect(live).toContain("useTranslations('Greeting')");
    const cat = JSON.parse(readFileSync(join(root, 'messages/en/Greeting.json'), 'utf8'));
    expect(cat).toMatchObject({ welcomeBack: 'Welcome back' });

    // collateral test wrapped + backed up under the promotion batch
    expect(readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8')).toContain(
      'NextIntlClientProvider',
    );
    expect(existsSync(join(root, res.backupPath))).toBe(true);
  });

  test('a promotion is reversible — rollback restores live source AND test', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root, stageAll: true });
    const res = promoteStaged(root, 'src/components/Greeting.tsx');

    const rb = rollback(root, res.batchId);
    expect(rb.ok).toBe(true);
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).toBe(HIGH_CONF_CLIENT);
    expect(readFileSync(join(root, 'src/components/Greeting.test.tsx'), 'utf8')).toBe(CO_LOCATED_TEST);
  });

  test('the staged entry is dropped after promotion — a second promote refuses cleanly', () => {
    const inv = scan(root, detect(root));
    const staged = extract(inv, { appRoot: root, stageAll: true });
    promoteStaged(root, 'src/components/Greeting.tsx');

    const sm = JSON.parse(readFileSync(join(root, staged.stagedManifestPath), 'utf8'));
    expect(sm.files['src/components/Greeting.tsx']).toBeUndefined();

    const second = promoteStaged(root, 'src/components/Greeting.tsx');
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/no staged rewrite/);
  });

  test('promoting a file that was never staged refuses without mutating', () => {
    write(root, 'src/components/Other.tsx', HIGH_CONF_CLIENT.replace('Greeting', 'Other'));
    const before = readFileSync(join(root, 'src/components/Other.tsx'), 'utf8');
    const res = promoteStaged(root, 'src/components/Other.tsx');
    expect(res.ok).toBe(false);
    expect(readFileSync(join(root, 'src/components/Other.tsx'), 'utf8')).toBe(before);
  });
});

// THE ROLLBACK-LEDGER COHERENCE BUG (M8). rollback() restores source bytes exactly,
// but historically never touched the extract ledger. After --rollback, the ledger
// still said `status: 'written'`, so the NEXT extract hit the skipped-done branch,
// reported `skipped-done`, and the rolled-back file was SILENTLY un-re-extractable
// (written:0, source not re-extracted) without the user deleting the ledger by hand.
// rollback now prunes the restored files from the ledger (+ staged manifest), and
// extract re-verifies a ledger-'written' file against the source markers as a
// belt-and-suspenders for out-of-band reverts (git checkout / manual edit).
describe('rollback ledger coherence — a rolled-back file is re-extractable', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('rollback prunes the rolled-back file from the extract ledger', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    // ledger recorded the write
    const ledgerPath = join(root, '.vibe-lingual/localize/state/extract-ledger.json');
    let ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    expect(ledger.files['src/components/Greeting.tsx'].status).toBe('written');

    const rb = rollback(root, report.batchId);
    expect(rb.ok).toBe(true);
    // THE FIX: the ledger entry is pruned, and rollback reports it.
    expect(rb.ledgerPruned).toContain('src/components/Greeting.tsx');
    ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    expect(ledger.files['src/components/Greeting.tsx']).toBeUndefined();
  });

  test('after rollback, a fresh extract re-extracts the file (not skipped-done)', () => {
    const inv = scan(root, detect(root));
    const first = extract(inv, { appRoot: root });
    expect(first.summary.written).toBe(1);

    const rb = rollback(root, first.batchId);
    expect(rb.ok).toBe(true);
    // source is back to its pre-extract bytes
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).toBe(HIGH_CONF_CLIENT);

    // re-scan (the SKILL's real flow) + re-extract — the file MUST write again, not
    // get stuck on a stale ledger entry.
    const inv2 = scan(root, detect(root));
    const second = extract(inv2, { appRoot: root });
    expect(second.summary.written).toBe(1);
    const r = second.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.status).toBe('written');
    // and the source is genuinely re-extracted
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).toContain(
      "useTranslations('Greeting')",
    );
  });

  test('belt-and-suspenders: a ledger-written file reverted OUT-OF-BAND re-extracts', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });

    // simulate a git checkout / manual revert: source goes back to pre-extract bytes
    // WITHOUT going through rollback (so the ledger is NOT pruned — it stays stale).
    writeFileSync(join(root, 'src/components/Greeting.tsx'), HIGH_CONF_CLIENT, 'utf8');
    const ledgerPath = join(root, '.vibe-lingual/localize/state/extract-ledger.json');
    expect(JSON.parse(readFileSync(ledgerPath, 'utf8')).files['src/components/Greeting.tsx'].status).toBe(
      'written',
    );

    // re-extract: the ledger says 'written', but the source markers are gone, so the
    // engine must NOT trust the ledger blindly — it re-extracts.
    const inv2 = scan(root, detect(root));
    const second = extract(inv2, { appRoot: root });
    const r = second.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.status).toBe('written');
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).toContain('useTranslations');
  });

  test('a genuinely-extracted file (markers present) still skips on re-run (no spurious re-extract)', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });
    // do NOT revert — the source still has its markers. A re-extract over the SAME
    // (un-rescanned) inventory must skip-done, not re-write.
    const second = extract(inv, { appRoot: root });
    const r = second.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.status).toBe('skipped-done');
    expect(r.reason).toMatch(/source markers confirm/);
    expect(second.summary.written).toBe(0);
  });

  test('a PROMOTED batch rollback prunes the ledger too (apply-staged coherence)', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root, stageAll: true });
    const promoted = promoteStaged(root, 'src/components/Greeting.tsx');
    expect(promoted.ok).toBe(true);

    const rb = rollback(root, promoted.batchId);
    expect(rb.ok).toBe(true);
    expect(rb.ledgerPruned).toContain('src/components/Greeting.tsx');

    // re-stage + re-promote works again — the file isn't stuck.
    const inv2 = scan(root, detect(root));
    const restaged = extract(inv2, { appRoot: root, stageAll: true });
    expect(restaged.summary.staged).toBe(1);
  });
});

// Phase-2 Celestia3 regression: a CLIENT component WITHOUT a 'use client'
// directive (it inherits the boundary from a parent) still uses client-only
// hooks (useState). extract.mjs must NOT force isClient:false from a directive-
// only probe and mask the transform's decideIsClient() — that produced an
// invalid `export default async function … getTranslations` server rewrite
// (an async server component cannot call useState). extract must DEFER (pass no
// explicit isClient) so the fixed decideIsClient classifies it CLIENT.
const DIRECTIVELESS_CLIENT = `import React, { useState } from 'react';

export default function WelcomeModal() {
  const [open, setOpen] = useState(false);
  return (
    <div className="wrap" onClick={() => setOpen(!open)}>
      <h1>Welcome back</h1>
      <p>Choose your destiny</p>
    </div>
  );
}
`;

describe('client classification — directive-less client component', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/WelcomeModal.tsx', DIRECTIVELESS_CLIENT);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a useState component with no "use client" extracts as CLIENT, not async server', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root, stageAll: true });
    const promoted = promoteStaged(root, 'src/components/WelcomeModal.tsx');
    expect(promoted.ok).toBe(true);

    const src = readFileSync(join(root, 'src/components/WelcomeModal.tsx'), 'utf8');
    // CLIENT path: useTranslations from 'next-intl', body-scoped, NO await/async.
    expect(src).toContain("import { useTranslations } from 'next-intl'");
    expect(src).toContain("const t = useTranslations('WelcomeModal')");
    // the bug: must NOT convert to async server component.
    expect(src).not.toContain('getTranslations');
    expect(src).not.toContain('next-intl/server');
    expect(src).not.toMatch(/export default async function/);
  });
});
