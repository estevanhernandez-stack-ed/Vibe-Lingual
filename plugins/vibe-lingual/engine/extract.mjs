// vibe-lingual engine — the extract step of the localize mutating loop (M8).
//
// The WRITE side. Orchestrates the next-intl transform codemod over a file set
// drawn from the scan inventory, with the three hard contracts from spec.md KTD-2:
//
//   1. CONFIDENCE ROUTING. Each ready file is routed by its aggregate confidence:
//        high   → auto-write (the codemod runs, the file + its catalog are written),
//                 backed up FIRST.
//        medium → STAGE to .vibe-lingual/localize/staged/<file>.tsx — the rewritten
//                 source is written to a staging mirror for human review, the real
//                 source is NOT touched, and the catalog is staged alongside.
//        low    → inline-only — no write at all; a suggestion the SKILL surfaces.
//
//   2. ATOMIC + NEVER-LOSE-A-CATALOG. A namespaced catalog (messages/<locale>/<NS>.json
//      or messages/<locale>.json keyed by namespace) is MERGED, never clobbered:
//      existing keys survive, new keys are added, and the merge is written via a
//      temp-file + rename so a crash mid-write can never leave a half-catalog.
//      The source file write is backed up first (rollback restores it exactly).
//
//   3. IDEMPOTENT / RESUMABLE. A file already fully extracted (the codemod reports
//      changed:false on it, OR it is recorded done in the extract ledger) is SKIPPED
//      on re-run. A second run over the same inventory converges to no new writes.
//
// Blocked files (audit readiness 'blocked' — firebase-admin SSR or an unhandled
// dynamic-route glob) are NEVER auto-written: they downgrade to inline-only with the
// block reason surfaced, regardless of confidence. The audit is the gate; this engine
// honors it.
//
// Pure-ish: filesystem + the in-process codemod only. No network, no app-code exec.

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join, dirname, sep } from 'node:path';
import jscodeshiftDefault from 'jscodeshift';
import { transform } from './adapters/next-intl/transform.mjs';
import { BackupBatch } from './backup.mjs';

// jscodeshift TS-aware parser — the collateral-test wrap is AST-based (same rigor
// as the codemod) so a multi-render() test file gets EVERY render call wrapped,
// not just the first. A regex pass mis-brackets adjacent nested-JSX calls and only
// rewrites the first match; the AST visits every `render(<JSX>)` call individually.
const jTest = jscodeshiftDefault.withParser('tsx');
const TEST_SRC_OPTS = { quote: 'single', trailingComma: true, tabWidth: 2 };

const STATE_DIR = join('.vibe-lingual', 'localize');
const STAGED_DIR = join(STATE_DIR, 'staged');
// the staged manifest makes a staged rewrite self-promotable: it records, per
// staged file, everything `--apply-staged` needs to read it back to the live tree
// (the live source target, the namespace + live catalog path, the staged catalog,
// and any collateral test) WITHOUT re-running scan/audit/the codemod.
const STAGED_MANIFEST_PATH = join(STAGED_DIR, 'staged-manifest.json');
const LEDGER_PATH = join(STATE_DIR, 'state', 'extract-ledger.json');
const DEFAULT_MESSAGES_DIR = 'messages';
const DEFAULT_SOURCE_LOCALE = 'en';

// ---------------------------------------------------------------------------
// confidence aggregation — a FILE's routing confidence is the most-cautious of
// its included sites. One low-confidence site in a file (a long interpolated
// toast, a date that needs the timeZone decision) pulls the whole file down to a
// review path: the codemod still rewrites the high-confidence siblings, but the
// file is staged/inline rather than silently auto-written. Conservative by
// construction — auto-write is reserved for files where EVERY site is high.
// ---------------------------------------------------------------------------

const CONF_RANK = { low: 0, medium: 1, high: 2 };

export function fileConfidence(sitesForFile) {
  if (!sitesForFile || sitesForFile.length === 0) return 'low';
  let worst = 'high';
  for (const s of sitesForFile) {
    if (CONF_RANK[s.confidence] < CONF_RANK[worst]) worst = s.confidence;
  }
  return worst;
}

const ROUTE_BY_CONFIDENCE = { high: 'auto-write', medium: 'stage', low: 'inline-only' };

// ---------------------------------------------------------------------------
// the file set — included (non-excluded) sites, grouped by file, in the audit's
// readiness order when an audit is supplied (blocked-first is fine; we skip them
// for writes but report them), else by descending site count.
// ---------------------------------------------------------------------------

function groupSitesByFile(inventory) {
  const byFile = new Map();
  for (const s of inventory.sites) {
    if (s.excluded) continue; // structural-Intl etc. — never extracted
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file).push(s);
  }
  return byFile;
}

// Map of file → readiness {status, reason} from an optional audit.
function readinessIndex(auditObj) {
  const idx = new Map();
  if (auditObj && Array.isArray(auditObj.readiness)) {
    for (const r of auditObj.readiness) idx.set(r.file, r);
  }
  return idx;
}

// Is a file a CLIENT component? Prefer the inventory site flag if present; else
// read the source for a "use client" directive (the codemod also self-detects,
// but extract needs the mode to record + to choose the catalog note).
function isClientFile(appRoot, relPath) {
  try {
    const src = readFileSync(join(appRoot, relPath), 'utf8');
    return /^\s*['"]use client['"]\s*;?/m.test(src.split('\n').slice(0, 5).join('\n')) ||
      /^['"]use client['"]/.test(src.trimStart());
  } catch {
    return null;
  }
}

// Does the source still bear an i18n extraction marker — a next-intl translation
// hook/import the codemod would have added? The extract ledger records a file as
// 'written', but the ledger can go STALE: a rollback restores the source bytes to
// their pre-extract state, OR a user reverts the file out-of-band (git checkout,
// manual edit). A blind ledger trust then reports `skipped-done` and SILENTLY
// refuses to re-extract a file whose translation calls are gone. Re-verifying the
// source against these markers makes extract self-healing: a ledger-'written' file
// whose markers have vanished is treated as eligible again, not stuck. Conservative
// — any ONE marker present means "still extracted"; only a fully-reverted file
// (no markers at all) re-opens for extraction.
const I18N_MARKER_RE =
  /\b(useTranslations|getTranslations|useFormatter)\s*\(|from\s+['"]next-intl(?:\/server)?['"]/;

function sourceStillExtracted(source) {
  return I18N_MARKER_RE.test(source);
}

// ---------------------------------------------------------------------------
// co-located test discovery (M8 AC: "a touched component's existing test gets the
// provider wrapper"). Adding next-intl hooks to a component breaks its EXISTING
// tests — they now need a `NextIntlClientProvider` wrapper. The extract phase MUST
// surface that collateral so the SKILL/agent cannot silently leave the suite red,
// and MUST pull any test it edits into the SAME backup batch (else `--rollback`
// restores the component but leaves the test provider-wrapped — an incoherent
// repo state the engine claims is "restored exactly").
//
// Conventions probed (relative to the component's rel path):
//   1. a SIBLING `<base>.test|spec.<ext>` next to the component.
//   2. a `__tests__/<base>.test|spec.<ext>` in the component's OWN dir.
//   3. a `<ancestor>/__tests__/<base>.test|spec.<ext>` for every ancestor dir up
//      to (and including) the app root — the project-root `src/__tests__/`
//      convention Celestia3 uses for its 93 suites (DEFECT 2). A component at
//      src/components/Foo.tsx finds its test at src/__tests__/Foo.test.tsx so the
//      NextIntlClientProvider wrap fires there too, not just on co-located tests.
// We return ALL matches (a component can carry both a .test and a .spec, and a
// sibling AND a root-__tests__ test) as rel POSIX paths, de-duplicated.
// ---------------------------------------------------------------------------

const TEST_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];

// Every directory from the component's own dir up to the app root, inclusive.
// '' (the app root itself) is included so a top-level __tests__/ is probed too.
// Defensive against a relPath that escapes the root (../) — stop at '.'/''.
function ancestorDirs(relDir) {
  const dirs = [];
  let cur = relDir === '.' ? '' : relDir;
  // walk up using POSIX-normalized segments so Windows separators don't leak.
  let guard = 0;
  while (guard++ < 64) {
    dirs.push(cur);
    if (cur === '' || cur === '.') break;
    const parent = dirname(cur);
    if (parent === cur) break; // root reached
    cur = parent === '.' ? '' : parent;
  }
  return dirs;
}

function findCollateralTests(appRoot, relPath) {
  const dir = dirname(relPath); // posix-ish; join handles separators
  // strip the component's own extension to get the base name.
  const file = relPath.slice(dir.length + 1);
  const base = file.replace(/\.(tsx|ts|jsx|js)$/i, '');

  const candidates = [];
  for (const kind of ['test', 'spec']) {
    for (const ext of TEST_EXTENSIONS) {
      // 1. sibling next to the component.
      candidates.push(join(dir, `${base}.${kind}.${ext}`));
      // 2 + 3. a __tests__/ at the component's dir AND every ancestor up to root.
      for (const anc of ancestorDirs(dir)) {
        candidates.push(join(anc, '__tests__', `${base}.${kind}.${ext}`));
      }
    }
  }

  const found = [];
  const seen = new Set();
  for (const rel of candidates) {
    const posix = rel.split(sep).join('/');
    if (seen.has(posix)) continue;
    seen.add(posix);
    if (existsSync(join(appRoot, rel))) {
      found.push(posix);
    }
  }
  return found;
}

// Build the <NextIntlClientProvider …> wrapper JSX element around an existing JSX
// argument.
//
// MESSAGES + NON-THROWING FALLBACK (DEFECT — the Celestia3 dogfood gap). next-intl
// 4.x does NOT echo a missing key back: an unresolved `t('foo')` THROWS
// `MISSING_MESSAGE` and turns the wrapped test red — the exact failure the wrap was
// meant to PREVENT. Two layers fix it:
//   1. Seed `messages` with the namespace block this run just extracted (so the
//      component's `t('shareMyDay')` resolves to the real source string and any
//      existing getByText assertion on that text still passes).
//   2. Add `onError={() => {}}` + `getMessageFallback={({ key }) => key}` so ANY
//      key outside the seeded set (a sibling namespace, a key from a later phase)
//      degrades to the key string instead of throwing. Belt-and-suspenders: the
//      seeded messages cover the happy path, the fallback guarantees no throw.
// `namespace`/`keys` may be absent (a generic wrap with no known namespace) — then
// `messages` is left empty and only the fallback protects the render.
function buildProviderWrap(j, jsxArg, namespace, keys) {
  const messagesObj =
    namespace && keys && Object.keys(keys).length > 0
      ? j.objectExpression([
          j.property(
            'init',
            j.stringLiteral(namespace),
            j.objectExpression(
              Object.entries(keys).map(([k, v]) =>
                j.property('init', j.stringLiteral(k), j.stringLiteral(String(v))),
              ),
            ),
          ),
        ])
      : j.objectExpression([]);

  // getMessageFallback={({ key }) => key} — an arrow returning the key string.
  const fallbackArrow = j.arrowFunctionExpression(
    [j.objectPattern([
      Object.assign(j.property('init', j.identifier('key'), j.identifier('key')), { shorthand: true }),
    ])],
    j.identifier('key'),
  );

  const open = j.jsxOpeningElement(
    j.jsxIdentifier('NextIntlClientProvider'),
    [
      j.jsxAttribute(j.jsxIdentifier('locale'), j.stringLiteral('en')),
      j.jsxAttribute(j.jsxIdentifier('messages'), j.jsxExpressionContainer(messagesObj)),
      j.jsxAttribute(j.jsxIdentifier('timeZone'), j.stringLiteral('UTC')),
      j.jsxAttribute(
        j.jsxIdentifier('onError'),
        j.jsxExpressionContainer(j.arrowFunctionExpression([], j.blockStatement([]))),
      ),
      j.jsxAttribute(j.jsxIdentifier('getMessageFallback'), j.jsxExpressionContainer(fallbackArrow)),
    ],
    false,
  );
  const close = j.jsxClosingElement(j.jsxIdentifier('NextIntlClientProvider'));
  // newline children keep recast's output readable when it reprints the call.
  return j.jsxElement(open, close, [j.jsxText('\n      '), jsxArg, j.jsxText('\n    ')]);
}

// Is this JSX node ALREADY wrapped in a NextIntlClientProvider (idempotency at the
// per-render-call level, not just file-level)? A second run must not double-wrap.
function isProviderWrapped(node) {
  return (
    node &&
    node.type === 'JSXElement' &&
    node.openingElement &&
    node.openingElement.name &&
    node.openingElement.name.name === 'NextIntlClientProvider'
  );
}

// Wrap a co-located test's render output in <NextIntlClientProvider> so the
// existing assertions still mount the now-i18n'd component. AST-based (jscodeshift)
// so EVERY `render(<JSX>)` call in the file is wrapped — the dominant React Testing
// Library pattern is one render() per `test()` block, and a regex pass rewrote only
// the FIRST, leaving the other N-1 renders BARE (each throws `No intl context found`
// → the app's own suite goes RED after an auto-write while the engine reported
// success). Per call:
//   - arg0 is a JSXElement/JSXFragment not yet provider-wrapped → wrap it (wrapped++).
//   - arg0 is already provider-wrapped → skip (idempotent), counts as neither.
//   - arg0 is NOT JSX (a variable, a function call) → CANNOT wrap cleanly; left as
//     is and counted into `manual` so the caller surfaces it for a hand wrap.
//
// Returns { code, changed, wrapped, manual, reason }:
//   wrapped — number of render calls the provider was applied to.
//   manual  — number of render calls that could not be wrapped cleanly (need a
//             hand wrap); these MUST flow into the run's collateralTestsNeedManualWrap
//             so a green banner is never rendered over a suite that will go red.
//   changed — true iff at least one render call was wrapped.
// When the wrap can't be applied to ANY call (no render(<JSX>) found, parse error)
// it returns { changed:false } with a reason and the SKILL falls back to a manual
// instruction — the test is STILL backed up by the caller, so rollback stays
// coherent either way.
function wrapTestWithProvider(source, namespace, keys) {
  let root;
  try {
    root = jTest(source);
  } catch (e) {
    return { code: source, changed: false, wrapped: 0, manual: 0, reason: `unparseable test (${e.message})` };
  }

  let wrapped = 0;
  let manual = 0;
  let alreadyWrapped = 0;

  // every `render(...)` call — bare callee identifier `render`. (RTL's customRender
  // wrappers are out of scope; the cowpath uses the standard `render`.)
  root.find(jTest.CallExpression, { callee: { type: 'Identifier', name: 'render' } }).forEach((p) => {
    const arg0 = p.node.arguments && p.node.arguments[0];
    if (!arg0) {
      manual += 1;
      return;
    }
    if (isProviderWrapped(arg0)) {
      alreadyWrapped += 1;
      return;
    }
    if (arg0.type === 'JSXElement' || arg0.type === 'JSXFragment') {
      p.node.arguments[0] = buildProviderWrap(jTest, arg0, namespace, keys);
      wrapped += 1;
      return;
    }
    // a non-JSX render arg (render(ui), render(buildUI())) — cannot wrap as JSX
    // without breaking it. Flag for a manual wrap; never corrupt the call.
    manual += 1;
  });

  if (wrapped === 0) {
    // nothing wrapped. If renders existed but were all non-JSX, say so; if some
    // were already wrapped (re-run), it's a clean idempotent no-op; else no render.
    let reason;
    if (manual > 0) reason = `${manual} render call(s) take a non-JSX argument — wrap manually`;
    else if (alreadyWrapped > 0) reason = 'already wrapped';
    else reason = 'no render(<JSX>) call to wrap';
    return { code: source, changed: false, wrapped: 0, manual, reason };
  }

  // inject the import once (skip if a NextIntlClientProvider import already exists).
  const hasImport =
    root
      .find(jTest.ImportDeclaration, { source: { value: 'next-intl' } })
      .filter((p) =>
        (p.node.specifiers || []).some(
          (s) => s.type === 'ImportSpecifier' && s.imported && s.imported.name === 'NextIntlClientProvider',
        ),
      )
      .size() > 0;
  if (!hasImport) {
    const decl = jTest.importDeclaration(
      [jTest.importSpecifier(jTest.identifier('NextIntlClientProvider'))],
      jTest.stringLiteral('next-intl'),
    );
    const imports = root.find(jTest.ImportDeclaration);
    if (imports.size() > 0) {
      imports.at(imports.size() - 1).insertAfter(decl);
    } else {
      root.get().node.program.body.unshift(decl);
    }
  }

  return { code: root.toSource(TEST_SRC_OPTS), changed: true, wrapped, manual };
}

// ---------------------------------------------------------------------------
// catalog merge — NEVER lose a key. Read the existing namespaced catalog (if
// any), deep-merge the new keys, write atomically (temp + rename).
//
// TWO LAYOUTS, MATCH THE APP'S EXISTING ONE (DEFECT 1 — the Celestia3 dogfood
// gap). next-intl can load either:
//
//   SPLIT      messages/<locale>/<NS>.json   — one file per namespace, holding a
//              flat key→text map. (The plugin's no-catalog default.)
//   FLAT       messages/<locale>.json        — ONE file per locale, keyed by
//              namespace at the top level: { "<NS>": { key: text } }. This is the
//              cowpath/Celestia3 shape AND exactly what the wired request.ts
//              template imports (`messages/${wanted}.json`).
//
// The request config the adapter wires (wire.mjs → request.ts.template) imports
// the FLAT file. So on an app already wired flat, writing a parallel SPLIT
// messages/<locale>/<NS>.json produces a catalog request.ts never reads — the
// t() keys resolve to MISSING_MESSAGE at runtime. The fix: detect the app's
// existing layout and write INTO it. Only default to SPLIT when no catalog
// exists for the locale yet (preserves the from-scratch shape + every test).
//
// detectCatalogLayout returns:
//   'flat'  — a messages/<locale>.json file exists.
//   'split' — a messages/<locale>/ directory exists.
//   null    — neither; the caller picks the default (split).
// FLAT WINS when both somehow exist (the wired request.ts reads the flat file;
// honor what the runtime actually loads).
// ---------------------------------------------------------------------------

// app-root-relative POSIX path for an absolute path under the root. Used for the
// backup API (which joins appRoot) and for reporting catalog paths consistently
// with the staged manifest (which already stores rel paths).
function relToRoot(appRoot, absPath) {
  // Normalize BOTH sides to posix before the prefix test. `appRoot` may arrive
  // posix-style (inventory.app.root is stored "C:/…") while absPath is built via
  // node's join() and so is platform-native ("C:\…" on Windows). A raw
  // startsWith over mixed separators is false on Windows, so relToRoot would
  // hand back the full ABSOLUTE path; a downstream join(appRoot, that) then
  // doubles the root ("…\app\C:\…\app\messages\en.json" → ENOENT). Compare on a
  // common separator, case-insensitively for the Windows drive letter.
  const aRootPosix = appRoot.split('\\').join('/');
  const aAbsPosix = absPath.split('\\').join('/');
  const matches = aAbsPosix.toLowerCase().startsWith(aRootPosix.toLowerCase());
  const rel = matches ? aAbsPosix.slice(aRootPosix.length) : aAbsPosix;
  return rel.replace(/^[/\\]+/, '').split(sep).join('/').split('\\').join('/');
}

function flatCatalogPath(appRoot, messagesDir, locale) {
  return join(appRoot, messagesDir, `${locale}.json`);
}

function splitCatalogPath(appRoot, messagesDir, locale, namespace) {
  return join(appRoot, messagesDir, locale, `${namespace}.json`);
}

function detectCatalogLayout(appRoot, messagesDir, locale) {
  const flat = flatCatalogPath(appRoot, messagesDir, locale);
  const splitDir = join(appRoot, messagesDir, locale);
  if (existsSync(flat)) return 'flat';
  if (existsSync(splitDir)) {
    try {
      if (statSync(splitDir).isDirectory()) return 'split';
    } catch {
      /* fall through */
    }
  }
  return null;
}

// Resolve the catalog target for a (locale, namespace), honoring the app's
// existing layout. Returns { layout, absPath } where:
//   layout 'flat'  → absPath = messages/<locale>.json (keys merge UNDER namespace)
//   layout 'split' → absPath = messages/<locale>/<NS>.json (keys merge flat)
function resolveCatalogTarget(appRoot, messagesDir, locale, namespace) {
  const layout = detectCatalogLayout(appRoot, messagesDir, locale) || 'split';
  const absPath =
    layout === 'flat'
      ? flatCatalogPath(appRoot, messagesDir, locale)
      : splitCatalogPath(appRoot, messagesDir, locale, namespace);
  return { layout, absPath };
}

// Layout-aware catalog merge. For SPLIT it is the plain key→text mergeCatalog.
// For FLAT it scopes the keys under the namespace inside the per-locale file:
// the flat file holds { "<NS>": { key: text }, "<OtherNS>": {...} }, so the
// merge reads the existing file, deep-merges the new keys under just THIS
// namespace (sibling namespaces untouched), and writes atomically. Existing
// keys win unless overwrite is set — same never-clobber-a-human-edit contract.
// Returns { added, kept, total, path, layout }.
function mergeCatalogForLayout(absPath, layout, namespace, keys, opts = {}) {
  if (layout !== 'flat') {
    return { ...mergeCatalog(absPath, keys, opts), layout: 'split' };
  }
  const { overwrite = false } = opts;
  let existing = {};
  if (existsSync(absPath)) {
    try {
      existing = JSON.parse(readFileSync(absPath, 'utf8')) || {};
    } catch {
      existing = {};
    }
  }
  // the namespace sub-object inside the flat file (preserve sibling namespaces).
  const nsExisting =
    existing[namespace] && typeof existing[namespace] === 'object' && !Array.isArray(existing[namespace])
      ? existing[namespace]
      : {};
  const nsMerged = { ...nsExisting };
  let added = 0;
  let kept = 0;
  for (const [k, v] of Object.entries(keys || {})) {
    if (Object.prototype.hasOwnProperty.call(nsMerged, k)) {
      kept += 1;
      if (overwrite) nsMerged[k] = v;
    } else {
      nsMerged[k] = v;
      added += 1;
    }
  }
  // stable key order within the namespace for a clean diff.
  const nsOrdered = {};
  for (const k of Object.keys(nsMerged).sort()) nsOrdered[k] = nsMerged[k];
  // rebuild the file with namespaces in sorted order, our namespace's keys sorted.
  const merged = { ...existing, [namespace]: nsOrdered };
  const ordered = {};
  for (const ns of Object.keys(merged).sort()) ordered[ns] = merged[ns];
  writeJsonAtomic(absPath, ordered);
  // total = keys under THIS namespace (the unit a localize run reasons about).
  return { added, kept, total: Object.keys(nsOrdered).length, path: absPath, layout: 'flat' };
}

// Atomic JSON write: write to <path>.tmp then rename over <path>. rename is atomic
// on a single volume, so a reader never sees a half-written catalog.
function writeJsonAtomic(absPath, obj) {
  mkdirSync(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  renameSync(tmp, absPath);
}

// Merge `keys` (key→text) into the namespaced catalog at `absPath`. Existing keys
// WIN unless overwrite is set (default: keep existing — a human may have edited a
// translation; re-extraction must not stomp it). Returns { added, kept, total }.
export function mergeCatalog(absPath, keys, { overwrite = false } = {}) {
  let existing = {};
  if (existsSync(absPath)) {
    try {
      existing = JSON.parse(readFileSync(absPath, 'utf8')) || {};
    } catch {
      existing = {};
    }
  }
  const merged = { ...existing };
  let added = 0;
  let kept = 0;
  for (const [k, v] of Object.entries(keys || {})) {
    if (Object.prototype.hasOwnProperty.call(merged, k)) {
      kept += 1;
      if (overwrite) merged[k] = v;
    } else {
      merged[k] = v;
      added += 1;
    }
  }
  // stable key order for a clean diff.
  const ordered = {};
  for (const k of Object.keys(merged).sort()) ordered[k] = merged[k];
  writeJsonAtomic(absPath, ordered);
  return { added, kept, total: Object.keys(ordered).length, path: absPath };
}

// ---------------------------------------------------------------------------
// the extract ledger — the resumability record. One entry per file the loop has
// processed, with the route taken + the keys written. A re-run reads it and skips
// files already auto-written (idempotency belt-and-suspenders on top of the
// codemod's own changed:false detection).
// ---------------------------------------------------------------------------

function readLedger(appRoot) {
  const p = join(appRoot, LEDGER_PATH);
  if (!existsSync(p)) return { schemaVersion: 1, files: {} };
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { schemaVersion: 1, files: {} };
  }
}

function writeLedger(appRoot, ledger) {
  writeJsonAtomic(join(appRoot, LEDGER_PATH), ledger);
}

// ---------------------------------------------------------------------------
// the staged manifest — the read-back contract for `--apply-staged`. One entry
// per staged file, keyed by the live source rel path, recording where the staged
// rewrite + staged catalog live and where they promote TO. Without this, a staged
// rewrite is a dead-end mirror nothing can read back; with it, promotion is a pure
// filesystem move (backup live → copy staged source over live → merge staged
// catalog into live → record in the ledger) needing no re-scan/re-codemod.
// ---------------------------------------------------------------------------

function readStagedManifest(appRoot) {
  const p = join(appRoot, STAGED_MANIFEST_PATH);
  if (!existsSync(p)) return { schemaVersion: 1, files: {} };
  try {
    const m = JSON.parse(readFileSync(p, 'utf8'));
    if (!m || typeof m !== 'object' || typeof m.files !== 'object') {
      return { schemaVersion: 1, files: {} };
    }
    return m;
  } catch {
    return { schemaVersion: 1, files: {} };
  }
}

function writeStagedManifest(appRoot, manifest) {
  writeJsonAtomic(join(appRoot, STAGED_MANIFEST_PATH), manifest);
}

// ---------------------------------------------------------------------------
// extract(inventory, options) — run the loop. Options:
//   appRoot         (required) — the target app root the inventory is relative to.
//   audit           — optional audit object; its readiness blocks auto-write.
//   messagesDir     — catalog dir (default 'messages').
//   sourceLocale    — the locale catalogs are written under (default 'en').
//   batch           — an open BackupBatch (the SKILL owns ONE per localize run);
//                     when omitted, extract opens its own.
//   dryRun          — plan only: route every file, write NOTHING (no source, no
//                     catalog, no backup, no ledger). For the SKILL's preview gate.
//   overwriteKeys   — pass through to mergeCatalog (default false: keep existing).
//   stageAll        — FORCE-STAGE: route every non-blocked, changed file to STAGE
//                     regardless of confidence (the cautious first pass). A
//                     high-confidence file that would auto-write instead stages.
//                     Blocked files stay inline-only (the audit gate still wins).
//
// Returns a report: { results[], summary, batchId, ledgerPath, stagedManifestPath }.
//   Each result: { file, route, confidence, status, reason, changed, keys, catalog,
//                  backupPath, collateralTests[] }
//   status ∈ { 'written','staged','inline-only','skipped-done','skipped-no-change',
//              'blocked' }.
//   collateralTests[] — co-located test files discovered for a written/staged
//   component. On auto-write they are backed up INTO the same batch (rollback
//   coherence) and provider-wrapped; on stage they are recorded so the SKILL can
//   wrap them when the rewrite is promoted.
// ---------------------------------------------------------------------------

export function extract(inventory, options = {}) {
  const appRoot = options.appRoot;
  if (!appRoot) throw new Error('extract: options.appRoot is required');
  const messagesDir = options.messagesDir || DEFAULT_MESSAGES_DIR;
  const sourceLocale = options.sourceLocale || DEFAULT_SOURCE_LOCALE;
  const dryRun = !!options.dryRun;
  const overwriteKeys = !!options.overwriteKeys;
  const stageAll = !!options.stageAll;

  const byFile = groupSitesByFile(inventory);
  const ready = readinessIndex(options.audit);
  const ledger = readLedger(appRoot);
  // staged manifest accumulator — promotion's read-back contract. Updated for
  // every file that routes to stage; persisted at the end of a non-dry run.
  const stagedManifest = readStagedManifest(appRoot);
  let stagedTouched = false;

  // ONE backup batch for the whole run (the SKILL may pass its own so backups and
  // catalog writes share a batch id for clean rollback). Only opened when we write.
  const batch = options.batch || new BackupBatch(appRoot);

  const results = [];
  // deterministic order: descending site count, then path (stable across runs).
  const files = [...byFile.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );

  for (const [file, sites] of files) {
    const confidence = fileConfidence(sites);
    let route = ROUTE_BY_CONFIDENCE[confidence];
    // FORCE-STAGE (--stage-all): the conservative first pass routes every file
    // that would auto-write to STAGE instead. A low-confidence file stays
    // inline-only (force-stage never PROMOTES a route, only demotes auto-write).
    // The audit's blocked gate below still wins over this.
    if (stageAll && route === 'auto-write') route = 'stage';
    const r = ready.get(file);

    // blocked files (firebase-admin SSR / unhandled dynamic-route glob) are NEVER
    // auto-written — downgrade to inline-only and surface the block reason.
    if (r && r.status === 'blocked') {
      results.push({
        file,
        route: 'inline-only',
        confidence,
        status: 'blocked',
        reason: r.reason,
        changed: false,
        keys: {},
        catalog: null,
        backupPath: null,
      });
      continue;
    }

    // read the source up front — both the ledger re-verify and the codemod need it.
    let source;
    try {
      source = readFileSync(join(appRoot, file), 'utf8');
    } catch (e) {
      results.push({
        file,
        route,
        confidence,
        status: 'skipped-no-change',
        reason: `source unreadable (${e.message})`,
        changed: false,
        keys: {},
        catalog: null,
        backupPath: null,
      });
      continue;
    }

    // already auto-written in a prior run? skip (resumability) — but ONLY if the
    // source still bears the i18n markers the prior run added. The ledger can go
    // stale: a rollback (or any out-of-band revert) restores the pre-extract bytes
    // while leaving the ledger entry 'written'. Blindly trusting it reports
    // `skipped-done` and silently refuses to re-extract a reverted file (the
    // coherence bug). Re-verify: markers present → genuinely done, skip; markers
    // gone → the ledger lies, fall through and re-extract. (rollback now prunes the
    // ledger directly, so this is the belt-and-suspenders for git/manual reverts.)
    const prior = ledger.files[file];
    if (prior && prior.status === 'written' && !dryRun) {
      if (sourceStillExtracted(source)) {
        results.push({
          file,
          route,
          confidence,
          status: 'skipped-done',
          reason: 'already extracted in a prior run (ledger, source markers confirm)',
          changed: false,
          keys: prior.keys || {},
          catalog: prior.catalog || null,
          backupPath: prior.backupPath || null,
        });
        continue;
      }
      // markers vanished — the ledger entry is stale (reverted out-of-band). Drop
      // it so the write below records a fresh entry, and fall through to re-extract.
      delete ledger.files[file];
    }

    const isClient = isClientFile(appRoot, file);
    const out = transform(source, {
      path: file,
      ...(isClient != null ? { isClient } : {}),
    });

    // codemod found nothing to rewrite → idempotent no-op (already extracted, or
    // no eligible sites despite the inventory listing some — e.g. all attribute
    // sites already wrapped). Resumable: nothing to do.
    if (!out.changed) {
      results.push({
        file,
        route,
        confidence,
        status: 'skipped-no-change',
        reason: 'codemod reported no change (already extracted or no eligible sites)',
        changed: false,
        keys: out.keys || {},
        catalog: null,
        backupPath: null,
      });
      continue;
    }

    const namespace = out.namespace;
    // Resolve the catalog target against the app's EXISTING layout (DEFECT 1):
    // a flat messages/<locale>.json gets keys merged UNDER the namespace; a split
    // messages/<locale>/ keeps the per-namespace file; no catalog yet → split
    // default. The wired request.ts loads the flat file, so writing split on a
    // flat-wired app yields MISSING_MESSAGE — this resolver closes that gap.
    const { layout: catalogLayout, absPath: catAbs } = resolveCatalogTarget(
      appRoot,
      messagesDir,
      sourceLocale,
      namespace,
    );
    // app-root-RELATIVE catalog path (POSIX) — what the backup API + the reported
    // result/ledger fields want (catAbs is absolute; never feed it to backupFile).
    const catRelToRoot = relToRoot(appRoot, catAbs);

    // Co-located tests for this component — discovered once, surfaced on EVERY
    // route so the SKILL/agent can never silently leave a suite red. On auto-write
    // they are pulled into the backup batch + provider-wrapped; on stage they are
    // recorded for the promotion step; on inline-only they are just surfaced.
    const collateralTests = findCollateralTests(appRoot, file);

    // ---- route: inline-only (low) — suggest, write nothing. ----
    if (route === 'inline-only') {
      results.push({
        file,
        route,
        confidence,
        status: 'inline-only',
        reason: 'low file confidence — suggestion only; no source/catalog written',
        changed: true,
        keys: out.keys,
        catalog: catRelToRoot,
        catalogLayout,
        backupPath: null,
        collateralTests,
      });
      continue;
    }

    // ---- route: stage (medium) — write the rewrite + catalog to a review mirror. ----
    if (route === 'stage') {
      // app-root-RELATIVE staged paths. The staged manifest must hold relative
      // paths so promotion can `join(appRoot, entry.stagedSource)` portably (an
      // absolute path stored here breaks join on Windows). The live catalog rel is
      // derived the same way so promotion knows where to merge keys back.
      const relStagedSource = join(STAGED_DIR, file).split(sep).join('/');
      // the staged catalog MIRROR is always a split per-namespace file under the
      // staged dir — it is a private key store the promotion reads back, never the
      // app's live layout. The LIVE catalog path + layout are resolved against the
      // app's existing shape (DEFECT 1) so promotion merges into what request.ts
      // actually loads (flat messages/<locale>.json under a namespace, or split).
      const relStagedCatalog = join(STAGED_DIR, messagesDir, sourceLocale, `${namespace}.json`)
        .split(sep)
        .join('/');
      const { layout: liveLayout, absPath: liveCatalogAbs } = resolveCatalogTarget(
        appRoot,
        messagesDir,
        sourceLocale,
        namespace,
      );
      const relLiveCatalog = relToRoot(appRoot, liveCatalogAbs);
      const stagedSourceAbs = join(appRoot, relStagedSource);
      const stagedCatalogAbs = join(appRoot, relStagedCatalog);
      if (!dryRun) {
        mkdirSync(dirname(stagedSourceAbs), { recursive: true });
        writeFileSync(stagedSourceAbs, out.code, 'utf8');
        // staged catalog is a fresh merge against any prior staged catalog (NOT the
        // live one — staging never touches live state). Always split in the mirror.
        mergeCatalog(stagedCatalogAbs, out.keys, { overwrite: overwriteKeys });
        // record the read-back contract so `--apply-staged <file>` can promote
        // this rewrite without re-scanning / re-running the codemod.
        stagedManifest.files[file.split(sep).join('/')] = {
          liveSource: file.split(sep).join('/'),
          stagedSource: relStagedSource,
          stagedCatalog: relStagedCatalog,
          liveCatalog: relLiveCatalog,
          liveLayout,
          namespace,
          messagesDir,
          sourceLocale,
          confidence,
          collateralTests,
          stagedAt: new Date().toISOString(),
        };
        stagedTouched = true;
      }
      results.push({
        file,
        route,
        confidence,
        status: 'staged',
        reason: stageAll && confidence === 'high'
          ? 'force-staged (--stage-all) — rewrite + catalog staged for review (live source untouched)'
          : 'medium file confidence — rewrite + catalog staged for review (live source untouched)',
        changed: true,
        keys: out.keys,
        namespace,
        catalog: relStagedCatalog,
        stagedSource: relStagedSource,
        backupPath: null,
        collateralTests,
      });
      continue;
    }

    // ---- route: auto-write (high) — backup FIRST, then write source + merge catalog. ----
    let backupPath = null;
    let catalogResult = null;
    const testEdits = [];
    if (!dryRun) {
      // ORDER IS LOAD-BEARING: backup → write source → merge catalog → ledger.
      backupPath = batch.backupFile(file);
      // collateral test files MUST enter the SAME batch BEFORE any edit, so
      // --rollback returns the repo to a coherent pre-localize state (component +
      // test both restored). Back up first; wrap second.
      for (const testRel of collateralTests) {
        const testBackup = batch.backupFile(testRel);
        const testSrc = readFileSync(join(appRoot, testRel), 'utf8');
        // Seed the wrapper with the namespace block this run extracted so the
        // component's t() calls resolve (non-throwing fallback covers the rest).
        const wrap = wrapTestWithProvider(testSrc, namespace, out.keys);
        if (wrap.changed) writeFileSync(join(appRoot, testRel), wrap.code, 'utf8');
        // per-RENDER-CALL accounting: a test file with N render() calls reports how
        // many were provider-wrapped vs how many still need a hand wrap. A file
        // where some renders wrapped and some did not is BOTH changed:true AND
        // needsManualWrap>0 — the banner must warn even though the file changed.
        testEdits.push({
          file: testRel,
          backupPath: testBackup,
          wrapped: wrap.changed,
          wrappedCount: wrap.wrapped,
          needsManualWrap: wrap.manual,
          reason: wrap.changed
            ? wrap.manual > 0
              ? `${wrap.wrapped} render call(s) provider-wrapped; ${wrap.manual} take a non-JSX argument — wrap those manually`
              : 'provider-wrapped'
            : `not auto-wrapped (${wrap.reason}) — wrap manually`,
        });
      }
      // back up the live catalog BEFORE the merge IF it already exists — so a
      // rollback restores a pre-existing flat/split catalog to its exact prior
      // bytes (the merge mutates it). A catalog the run CREATES is not backed up
      // (there is nothing to restore TO); rollback removes those created files
      // instead (see backup.mjs createdCatalogs handling). The backup/record API
      // takes an app-root-RELATIVE path, so feed it catRelToRoot (NOT catAbs).
      const catalogExistedBefore = existsSync(catAbs);
      if (catalogExistedBefore) batch.backupFile(catRelToRoot);
      writeFileSync(join(appRoot, file), out.code, 'utf8');
      catalogResult = mergeCatalogForLayout(catAbs, catalogLayout, namespace, out.keys, {
        overwrite: overwriteKeys,
      });
      // record a catalog the run CREATED (did not exist before) so --rollback can
      // delete it — leaving no dangling namespace catalog after a revert (MINOR).
      if (!catalogExistedBefore) batch.recordCreatedCatalog(catRelToRoot);
      ledger.files[file] = {
        status: 'written',
        confidence,
        namespace,
        layout: catalogLayout,
        keys: out.keys,
        catalog: catRelToRoot,
        catalogCreated: !catalogExistedBefore,
        backupPath,
        collateralTests,
        batchId: batch.batchId,
        at: new Date().toISOString(),
      };
    }
    results.push({
      file,
      route,
      confidence,
      status: dryRun ? 'inline-only' : 'written',
      reason: dryRun
        ? 'dry-run: would auto-write (high confidence)'
        : 'high file confidence — source rewritten + catalog merged (backed up)',
      changed: true,
      keys: out.keys,
      namespace,
      catalog: catRelToRoot,
      catalogLayout,
      catalogMerge: catalogResult ? { added: catalogResult.added, kept: catalogResult.kept } : null,
      backupPath,
      collateralTests,
      testEdits,
    });
  }

  // commit the backup manifest + the ledger only if we actually wrote.
  let manifest = null;
  if (!dryRun) {
    const wroteAny = results.some((x) => x.status === 'written');
    if (wroteAny) {
      manifest = batch.commit({ trigger: 'extract' });
      writeLedger(appRoot, ledger);
    }
    // persist the staged manifest if any file routed to stage this run — it is the
    // read-back contract `--apply-staged` depends on.
    if (stagedTouched) writeStagedManifest(appRoot, stagedManifest);
  }

  const summary = {
    files: results.length,
    written: results.filter((x) => x.status === 'written').length,
    staged: results.filter((x) => x.status === 'staged').length,
    inlineOnly: results.filter((x) => x.status === 'inline-only').length,
    blocked: results.filter((x) => x.status === 'blocked').length,
    skippedDone: results.filter((x) => x.status === 'skipped-done').length,
    skippedNoChange: results.filter((x) => x.status === 'skipped-no-change').length,
    keysWritten: results
      .filter((x) => x.status === 'written')
      .reduce((n, x) => n + Object.keys(x.keys || {}).length, 0),
    // collateral-test accounting — how many co-located tests were touched, and how
    // many auto-wrapped vs need a manual wrap. Surfaced so the SKILL can warn before
    // the suite goes red, and so rollback coverage is auditable.
    //
    // The counts are per-RENDER-CALL, not per-file: a test file with 3 render()
    // calls where 1 wrapped and 2 take a non-JSX arg contributes 1 to wrapped and
    // 2 to needManualWrap — even though the FILE changed. This is the M8 safety
    // fix: a file that wrapped SOME renders but left others bare must still warn,
    // or the banner shows green over a suite that throws `No intl context found`.
    collateralTests: results.reduce((n, x) => n + (x.collateralTests ? x.collateralTests.length : 0), 0),
    collateralTestsWrapped: results.reduce(
      (n, x) =>
        n +
        (x.testEdits
          ? x.testEdits.reduce(
              (m, t) => m + (typeof t.wrappedCount === 'number' ? t.wrappedCount : t.wrapped ? 1 : 0),
              0,
            )
          : 0),
      0,
    ),
    collateralTestsNeedManualWrap: results.reduce(
      (n, x) =>
        n +
        (x.testEdits
          ? x.testEdits.reduce(
              (m, t) =>
                m +
                (typeof t.needsManualWrap === 'number'
                  ? t.needsManualWrap
                  : t.wrapped
                  ? 0
                  : 1),
              0,
            )
          : 0),
      0,
    ),
  };

  return {
    results,
    summary,
    batchId: manifest ? manifest.batchId : null,
    ledgerPath: join(STATE_DIR, 'state', 'extract-ledger.json').split(sep).join('/'),
    stagedManifestPath: STAGED_MANIFEST_PATH.split(sep).join('/'),
    dryRun,
  };
}

// ---------------------------------------------------------------------------
// promoteStaged(appRoot, file, options) — the `--apply-staged <file>` engine path.
//
// Promotes ONE previously-staged rewrite from .vibe-lingual/localize/staged/<file>
// to the live source tree, with the SAME backup discipline as auto-write so the
// promotion is reversible. Reads the staged manifest (the read-back contract) to
// know the live target + the live catalog path + namespace + collateral tests —
// no re-scan, no re-codemod. Order is LOAD-BEARING, identical to auto-write:
//
//   backup live (+ collateral tests) → copy staged source over live →
//   merge staged catalog INTO the live catalog → wrap collateral tests →
//   ledger entry → drop the staged mirror + manifest entry.
//
// `file` is the LIVE source rel path (the manifest key), e.g.
// 'src/components/Card.tsx'. Returns:
//   { ok, file, batchId, backupPath, liveSource, liveCatalog, keysMerged,
//     testEdits[], error? }
// A file with no staged entry (never staged, or already promoted) returns
// { ok:false, error } — the SKILL surfaces it, mutates nothing.
// ---------------------------------------------------------------------------

export function promoteStaged(appRoot, file, options = {}) {
  if (!appRoot) throw new Error('promoteStaged: appRoot is required');
  if (!file) throw new Error('promoteStaged: a staged file (live rel path) is required');
  const overwriteKeys = !!options.overwriteKeys;
  const key = file.split(sep).join('/');

  const stagedManifest = readStagedManifest(appRoot);
  const entry = stagedManifest.files[key];
  if (!entry) {
    return {
      ok: false,
      file: key,
      error:
        `no staged rewrite for "${key}". Either it was never staged, or it was already ` +
        `promoted. Run \`vibe-lingual extract\` (a medium/force-staged file stages it) first.`,
    };
  }

  const stagedSourceAbs = join(appRoot, entry.stagedSource);
  if (!existsSync(stagedSourceAbs)) {
    return {
      ok: false,
      file: key,
      error: `staged source missing at "${entry.stagedSource}" — the staged mirror is gone; re-stage with \`vibe-lingual extract\`.`,
    };
  }
  const stagedCode = readFileSync(stagedSourceAbs, 'utf8');

  // staged catalog (the keys this rewrite needs) — may be absent if the rewrite had
  // no keys; treat absent as an empty merge (still promote the source).
  let stagedKeys = {};
  const stagedCatalogAbs = join(appRoot, entry.stagedCatalog);
  if (existsSync(stagedCatalogAbs)) {
    try {
      stagedKeys = JSON.parse(readFileSync(stagedCatalogAbs, 'utf8')) || {};
    } catch {
      stagedKeys = {};
    }
  }

  const batch = options.batch || new BackupBatch(appRoot);
  const ledger = readLedger(appRoot);

  // ORDER: backup live (+ tests) → write live → merge catalog → wrap tests → ledger.
  const backupPath = batch.backupFile(file);

  const testEdits = [];
  const collateralTests = Array.isArray(entry.collateralTests) ? entry.collateralTests : [];
  for (const testRel of collateralTests) {
    if (!existsSync(join(appRoot, testRel))) continue;
    const testBackup = batch.backupFile(testRel);
    const testSrc = readFileSync(join(appRoot, testRel), 'utf8');
    // stagedKeys for a FLAT catalog is { "<NS>": {…} }; for SPLIT it is the flat
    // key→text map directly. Pass the namespace block so the wrapper seeds real
    // messages and the promoted component's t() calls resolve.
    const nsKeys =
      stagedKeys && typeof stagedKeys[entry.namespace] === 'object'
        ? stagedKeys[entry.namespace]
        : stagedKeys;
    const wrap = wrapTestWithProvider(testSrc, entry.namespace, nsKeys);
    if (wrap.changed) writeFileSync(join(appRoot, testRel), wrap.code, 'utf8');
    testEdits.push({
      file: testRel,
      backupPath: testBackup,
      wrapped: wrap.changed,
      wrappedCount: wrap.wrapped,
      needsManualWrap: wrap.manual,
      reason: wrap.changed
        ? wrap.manual > 0
          ? `${wrap.wrapped} render call(s) provider-wrapped; ${wrap.manual} take a non-JSX argument — wrap those manually`
          : 'provider-wrapped'
        : `not auto-wrapped (${wrap.reason}) — wrap manually`,
    });
  }

  writeFileSync(join(appRoot, file), stagedCode, 'utf8');
  const liveCatalogAbs = join(appRoot, entry.liveCatalog);
  // honor the live layout the staging step resolved (DEFECT 1). Older staged
  // manifests (pre-fix) lack liveLayout — re-resolve against the app as a fallback
  // so a manifest written before this fix still promotes into the right shape.
  const liveLayout =
    entry.liveLayout ||
    detectCatalogLayout(appRoot, entry.messagesDir || DEFAULT_MESSAGES_DIR, entry.sourceLocale || DEFAULT_SOURCE_LOCALE) ||
    'split';
  // back up a pre-existing live catalog before the merge; record a created one so
  // a rollback of this promotion removes the dangling catalog (MINOR).
  const liveCatalogExistedBefore = existsSync(liveCatalogAbs);
  if (liveCatalogExistedBefore) batch.backupFile(entry.liveCatalog);
  const merge = mergeCatalogForLayout(liveCatalogAbs, liveLayout, entry.namespace, stagedKeys, {
    overwrite: overwriteKeys,
  });
  if (!liveCatalogExistedBefore) batch.recordCreatedCatalog(entry.liveCatalog);

  ledger.files[key] = {
    status: 'written',
    confidence: entry.confidence,
    namespace: entry.namespace,
    layout: liveLayout,
    keys: stagedKeys,
    catalog: entry.liveCatalog,
    catalogCreated: !liveCatalogExistedBefore,
    backupPath,
    collateralTests,
    batchId: batch.batchId,
    promotedFromStaged: true,
    at: new Date().toISOString(),
  };

  const manifest = batch.commit({ trigger: 'apply-staged', file: key });
  writeLedger(appRoot, ledger);

  // drop the promoted entry from the staged manifest (and the staged mirror files)
  // so a re-run doesn't re-offer an already-promoted rewrite.
  delete stagedManifest.files[key];
  writeStagedManifest(appRoot, stagedManifest);
  for (const p of [stagedSourceAbs, stagedCatalogAbs]) {
    try {
      if (existsSync(p)) rmSync(p);
    } catch {
      /* best-effort cleanup; the manifest entry is already gone */
    }
  }

  return {
    ok: true,
    file: key,
    batchId: manifest ? manifest.batchId : batch.batchId,
    backupPath,
    liveSource: key,
    liveCatalog: entry.liveCatalog,
    namespace: entry.namespace,
    keysMerged: { added: merge.added, kept: merge.kept, total: merge.total },
    testEdits,
  };
}

export default extract;
