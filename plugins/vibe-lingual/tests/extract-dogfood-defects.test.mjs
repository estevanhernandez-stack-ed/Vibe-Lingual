// Regression tests for the three defects the full Celestia3 dogfood exposed
// (real-app integration gaps the unit suite missed). One describe per defect.
//
//   DEFECT 1 (P0, runtime-breaking): catalog layout must MATCH the app's existing
//     shape. A flat messages/<locale>.json keyed by namespace (the cowpath /
//     Celestia3 shape, also what request.ts loads) must get new keys MERGED under
//     the namespace inside that flat file — NOT written to a parallel
//     messages/<locale>/<NS>.json the request config never imports (→
//     MISSING_MESSAGE at runtime). Split stays the no-catalog default.
//
//   DEFECT 2 (P0, test-breaking): collateral-test discovery must walk ancestor
//     dirs probing <ancestor>/__tests__/<base>.test|spec.<ext>, so a component at
//     src/components/Foo.tsx finds its test at the project-root src/__tests__/
//     convention (Celestia3 uses it for 93 suites) and the NextIntlClientProvider
//     wrap fires there too — not only on co-located / same-dir __tests__ tests.
//
//   MINOR: --rollback must also remove catalog files the rolled-back batch CREATED
//     (an orphan messages/en/<NS>.json), so a rollback leaves no dangling namespace
//     catalog — not just the restored source.

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
import { extract, promoteStaged } from '../engine/extract.mjs';
import { rollback } from '../engine/backup.mjs';

function tmpApp() {
  const root = mkdtempSync(join(tmpdir(), 'vl-dogfood-'));
  mkdirSync(join(root, 'src', 'components'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }), 'utf8');
  return root;
}

function write(root, rel, contents) {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), contents, 'utf8');
}

// a high-confidence client component: short JSX text → high → auto-write.
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

// ---------------------------------------------------------------------------
// DEFECT 1 — match the app's existing catalog layout.
// ---------------------------------------------------------------------------
describe('DEFECT 1 — flat catalog layout: merge UNDER the namespace, not a parallel split file', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a pre-wired FLAT messages/en.json gets new keys merged under the namespace key', () => {
    // the app is already wired flat — request.ts loads messages/${locale}.json.
    // seed it with a sibling namespace so the merge must PRESERVE siblings.
    mkdirSync(join(root, 'messages'), { recursive: true });
    writeFileSync(
      join(root, 'messages/en.json'),
      JSON.stringify({ common: { ok: 'OK' } }, null, 2),
      'utf8',
    );

    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });

    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.status).toBe('written');
    // the engine recognized the flat layout and reported it.
    expect(r.catalogLayout).toBe('flat');

    // NO parallel split catalog — the bug was writing messages/en/Greeting.json
    // that request.ts never imports.
    expect(existsSync(join(root, 'messages/en/Greeting.json'))).toBe(false);

    // the flat file now holds the namespace sub-object with the extracted keys,
    // and the pre-existing sibling namespace survived untouched.
    const flat = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'));
    expect(flat.common).toEqual({ ok: 'OK' }); // sibling preserved
    expect(flat.Greeting).toBeDefined();
    expect(flat.Greeting.welcomeBack).toBe('Welcome back');
    expect(flat.Greeting.chooseYourDestiny).toBe('Choose your destiny');
  });

  test("request.ts's resolution path finds the new t() keys (no MISSING_MESSAGE)", () => {
    // model exactly what next-intl does at request time on a flat-wired app:
    //   messages = (await import(`../messages/${locale}.json`)).default
    //   useTranslations('Greeting')('welcomeBack') → messages['Greeting']['welcomeBack']
    mkdirSync(join(root, 'messages'), { recursive: true });
    writeFileSync(join(root, 'messages/en.json'), JSON.stringify({}, null, 2), 'utf8');

    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });

    // the rewritten source calls useTranslations('Greeting') with t('welcomeBack').
    const src = readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8');
    expect(src).toContain("useTranslations('Greeting')");
    expect(src).toContain("{t('welcomeBack')}");

    // resolve the key through the SAME indexing next-intl uses against the flat file.
    const messages = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'));
    expect(messages.Greeting).toBeDefined();
    expect(messages.Greeting.welcomeBack).toBe('Welcome back'); // resolves, not MISSING_MESSAGE
  });

  test('an existing namespace block in the flat file is merged into, human edits preserved', () => {
    mkdirSync(join(root, 'messages'), { recursive: true });
    // a human already translated welcomeBack and added a hand key under Greeting.
    writeFileSync(
      join(root, 'messages/en.json'),
      JSON.stringify({ Greeting: { welcomeBack: 'Welcome home', handKey: 'kept' } }, null, 2),
      'utf8',
    );

    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });

    const flat = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'));
    // existing key wins (no clobber), hand key survives, new key added.
    expect(flat.Greeting.welcomeBack).toBe('Welcome home');
    expect(flat.Greeting.handKey).toBe('kept');
    expect(flat.Greeting.chooseYourDestiny).toBe('Choose your destiny');
  });

  test('with NO existing catalog, the default stays SPLIT (from-scratch shape preserved)', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.catalogLayout).toBe('split');
    expect(existsSync(join(root, 'messages/en/Greeting.json'))).toBe(true);
    expect(existsSync(join(root, 'messages/en.json'))).toBe(false);
  });

  test('an existing SPLIT messages/en/ dir keeps the split layout', () => {
    // a split catalog already exists for a sibling namespace — stay split.
    mkdirSync(join(root, 'messages/en'), { recursive: true });
    writeFileSync(join(root, 'messages/en/common.json'), JSON.stringify({ ok: 'OK' }), 'utf8');

    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.catalogLayout).toBe('split');
    expect(existsSync(join(root, 'messages/en/Greeting.json'))).toBe(true);
  });

  test('a STAGED+promoted flat-wired app merges into the flat file too', () => {
    mkdirSync(join(root, 'messages'), { recursive: true });
    writeFileSync(join(root, 'messages/en.json'), JSON.stringify({}, null, 2), 'utf8');

    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root, stageAll: true }); // stage first
    const res = promoteStaged(root, 'src/components/Greeting.tsx');
    expect(res.ok).toBe(true);

    // promotion merged into the flat file under the namespace, not a split file.
    expect(existsSync(join(root, 'messages/en/Greeting.json'))).toBe(false);
    const flat = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'));
    expect(flat.Greeting.welcomeBack).toBe('Welcome back');
  });
});

// ---------------------------------------------------------------------------
// DEFECT 2 — collateral-test discovery walks ancestor __tests__/ dirs.
// ---------------------------------------------------------------------------

// a co-located test that lives at the PROJECT-ROOT src/__tests__/ convention,
// NOT next to the component (Celestia3's 93-suite layout).
const ROOT_TESTS_LAYOUT_TEST = `import { render, screen } from '@testing-library/react';
import Greeting from '../components/Greeting';

test('renders the greeting', () => {
  render(<Greeting />);
});
`;

describe('DEFECT 2 — root src/__tests__/ collateral test is discovered + wrapped', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    // component at src/components/Greeting.tsx
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
    // its test at the PROJECT-ROOT src/__tests__/Greeting.test.tsx (NOT co-located,
    // NOT in src/components/__tests__/). The old prober missed this entirely.
    write(root, 'src/__tests__/Greeting.test.tsx', ROOT_TESTS_LAYOUT_TEST);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('the ancestor src/__tests__/ test is found and surfaced', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });

    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.status).toBe('written');
    // THE FIX: the root-__tests__ test is discovered, not silently missed.
    expect(r.collateralTests).toContain('src/__tests__/Greeting.test.tsx');
    expect(report.summary.collateralTests).toBe(1);
    expect(report.summary.collateralTestsWrapped).toBe(1);
  });

  test('the NextIntlClientProvider wrap fires on the root-__tests__ test', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });

    const testNow = readFileSync(join(root, 'src/__tests__/Greeting.test.tsx'), 'utf8');
    expect(testNow).toContain('NextIntlClientProvider');
    expect(testNow).toContain("import { NextIntlClientProvider } from 'next-intl';");
    // the render call's first arg is now the provider — no bare render(<Greeting/>).
    expect(/render\(\s*<Greeting/.test(testNow)).toBe(false);
  });

  test('the root-__tests__ test enters the SAME backup batch + rollback restores it', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });

    const manifest = JSON.parse(
      readFileSync(join(root, '.vibe-lingual/localize/backup', report.batchId, 'manifest.json'), 'utf8'),
    );
    const sources = manifest.files.map((f) => f.source);
    expect(sources).toContain('src/__tests__/Greeting.test.tsx');

    const rb = rollback(root, report.batchId);
    expect(rb.ok).toBe(true);
    expect(readFileSync(join(root, 'src/__tests__/Greeting.test.tsx'), 'utf8')).toBe(ROOT_TESTS_LAYOUT_TEST);
  });

  test('a deeper component still finds its test at the app-root __tests__/', () => {
    // component nested two levels deep; test at src/__tests__/ (a higher ancestor).
    rmSync(join(root, 'src/components/Greeting.tsx'));
    rmSync(join(root, 'src/__tests__/Greeting.test.tsx'));
    write(root, 'src/components/cards/Greeting.tsx', HIGH_CONF_CLIENT);
    write(
      root,
      'src/__tests__/Greeting.test.tsx',
      ROOT_TESTS_LAYOUT_TEST.replace('../components/Greeting', '../components/cards/Greeting'),
    );

    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    const r = report.results.find((x) => x.file === 'src/components/cards/Greeting.tsx');
    expect(r.collateralTests).toContain('src/__tests__/Greeting.test.tsx');
  });
});

// ---------------------------------------------------------------------------
// MINOR — rollback removes catalogs the batch created.
// ---------------------------------------------------------------------------
describe('MINOR — rollback removes a catalog the batch created (no dangling catalog)', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('a created split catalog is deleted on rollback', () => {
    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    const catPath = join(root, 'messages/en/Greeting.json');
    expect(existsSync(catPath)).toBe(true); // the run created it

    const rb = rollback(root, report.batchId);
    expect(rb.ok).toBe(true);
    // THE FIX: the created catalog is removed + reported, leaving no orphan.
    expect(rb.catalogsRemoved).toContain('messages/en/Greeting.json');
    expect(existsSync(catPath)).toBe(false);
    // source restored to its exact pre-extract bytes.
    expect(readFileSync(join(root, 'src/components/Greeting.tsx'), 'utf8')).toBe(HIGH_CONF_CLIENT);
  });

  test('a PRE-EXISTING flat catalog is restored (not deleted) on rollback', () => {
    // a catalog the run did NOT create must be RESTORED to its prior bytes, never
    // deleted — only run-created catalogs are removed.
    mkdirSync(join(root, 'messages'), { recursive: true });
    const flatPath = join(root, 'messages/en.json');
    const before = JSON.stringify({ common: { ok: 'OK' } }, null, 2) + '\n';
    writeFileSync(flatPath, before, 'utf8');

    const inv = scan(root, detect(root));
    const report = extract(inv, { appRoot: root });
    // it grew a Greeting namespace from the extract.
    expect(JSON.parse(readFileSync(flatPath, 'utf8')).Greeting).toBeDefined();

    const rb = rollback(root, report.batchId);
    expect(rb.ok).toBe(true);
    // not in catalogsRemoved (it existed before) — it was restored instead.
    expect(rb.catalogsRemoved || []).not.toContain('messages/en.json');
    // restored to its EXACT prior bytes — the extracted namespace is gone.
    expect(readFileSync(flatPath, 'utf8')).toBe(before);
  });

  test('a promoted-batch rollback also removes a catalog the promotion created', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root, stageAll: true });
    const res = promoteStaged(root, 'src/components/Greeting.tsx');
    expect(res.ok).toBe(true);
    const catPath = join(root, 'messages/en/Greeting.json');
    expect(existsSync(catPath)).toBe(true);

    const rb = rollback(root, res.batchId);
    expect(rb.ok).toBe(true);
    expect(rb.catalogsRemoved).toContain('messages/en/Greeting.json');
    expect(existsSync(catPath)).toBe(false);
  });
});

// ===========================================================================
// SECOND DOGFOOD (full M10 loop on real Celestia3) — three more defects the
// unit suite missed, each a real-app integration gap:
//
//   DEFECT 3 (P0, Windows-only, crash): relToRoot's prefix test was separator-
//     sensitive. inventory.app.root is stored posix ("C:/…") while a join()-built
//     catalog path is native ("C:\…"); the mixed-separator startsWith() was false,
//     so relToRoot returned the ABSOLUTE path, and a downstream join(appRoot, that)
//     doubled the root → ENOENT, crashing the entire auto-write path on the first
//     app with a pre-existing catalog. Every Windows user hit this immediately.
//
//   DEFECT 4 (P0, test-breaking): the test wrapper used messages={{}}. next-intl
//     4.x does NOT echo a missing key — t('foo') THROWS MISSING_MESSAGE, turning
//     every wrapped test red. The wrap must seed the extracted namespace messages
//     AND add a non-throwing fallback (onError + getMessageFallback → key).
//
//   DEFECT 5 (test-discovery pollution): the plugin's own backups under
//     .vibe-lingual/localize/backup/<batch>/ mirror the source tree, INCLUDING
//     *.test.tsx copies. Jest globs them as live suites and the bare, pre-wrap
//     copies fail (No intl context). The wire jest patch must add .vibe-lingual/
//     to testPathIgnorePatterns.
// ===========================================================================

// a high-confidence client component WITH a co-located test, for the wrapper tests.
const WRAP_TEST = `import { render, screen } from '@testing-library/react';
import Greeting from '../components/Greeting';

test('renders welcome', () => {
  render(<Greeting />);
});

test('renders again', () => {
  render(<Greeting />);
});
`;

describe('DEFECT 3 — relToRoot survives a posix appRoot + native catalog path (no doubled path)', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
    // a PRE-EXISTING flat catalog forces the pre-merge backupFile(catRelToRoot)
    // path — the exact call that crashed when relToRoot handed back an abs path.
    mkdirSync(join(root, 'messages'), { recursive: true });
    writeFileSync(join(root, 'messages/en.json'), JSON.stringify({ common: { ok: 'OK' } }, null, 2), 'utf8');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('extract does NOT crash when app.root is posix-style and the catalog exists', () => {
    const inv = scan(root, detect(root));
    // force the posix-slash form the real scan stores (and that broke startsWith).
    inv.app.root = root.split('\\').join('/');
    // the bug threw ENOENT here; the fix makes it complete cleanly.
    const report = extract(inv, { appRoot: inv.app.root });
    const r = report.results.find((x) => x.file === 'src/components/Greeting.tsx');
    expect(r.status).toBe('written');
    // the pre-existing catalog was backed up under a SANE (non-doubled) rel path.
    const manifest = JSON.parse(
      readFileSync(join(root, '.vibe-lingual/localize/backup', report.batchId, 'manifest.json'), 'utf8'),
    );
    expect(manifest.files.map((f) => f.source)).toContain('messages/en.json');
    // the flat catalog grew the namespace, siblings intact.
    const flat = JSON.parse(readFileSync(join(root, 'messages/en.json'), 'utf8'));
    expect(flat.common).toEqual({ ok: 'OK' });
    expect(flat.Greeting).toBeDefined();
  });
});

describe('DEFECT 4 — the test wrapper seeds real messages + a non-throwing fallback', () => {
  let root;
  beforeEach(() => {
    root = tmpApp();
    write(root, 'src/components/Greeting.tsx', HIGH_CONF_CLIENT);
    write(root, 'src/__tests__/Greeting.test.tsx', WRAP_TEST);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('the wrapped provider carries the extracted namespace messages, not messages={{}}', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });
    const testNow = readFileSync(join(root, 'src/__tests__/Greeting.test.tsx'), 'utf8');
    // real messages seeded (so t('welcomeBack') resolves, not MISSING_MESSAGE).
    expect(testNow).toContain('Greeting');
    expect(testNow).toContain('Welcome back');
    expect(testNow).not.toContain('messages={{}}');
    // the empty-object literal regex must NOT match the messages attr anymore.
    expect(/messages=\{\{\s*\}\}/.test(testNow)).toBe(false);
  });

  test('a non-throwing getMessageFallback + onError is present on every wrap', () => {
    const inv = scan(root, detect(root));
    extract(inv, { appRoot: root });
    const testNow = readFileSync(join(root, 'src/__tests__/Greeting.test.tsx'), 'utf8');
    // both render calls wrapped, each with the fallback (so an out-of-namespace key
    // degrades to the key string instead of throwing).
    const fallbacks = (testNow.match(/getMessageFallback=/g) || []).length;
    expect(fallbacks).toBe(2);
    expect((testNow.match(/onError=/g) || []).length).toBe(2);
  });
});
