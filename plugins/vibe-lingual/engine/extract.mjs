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
} from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { transform } from './adapters/next-intl/transform.mjs';
import { BackupBatch } from './backup.mjs';

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

// ---------------------------------------------------------------------------
// co-located test discovery (M8 AC: "a touched component's existing test gets the
// provider wrapper"). Adding next-intl hooks to a component breaks its EXISTING
// tests — they now need a `NextIntlClientProvider` wrapper. The extract phase MUST
// surface that collateral so the SKILL/agent cannot silently leave the suite red,
// and MUST pull any test it edits into the SAME backup batch (else `--rollback`
// restores the component but leaves the test provider-wrapped — an incoherent
// repo state the engine claims is "restored exactly").
//
// Conventions probed (relative to the component's rel path), first match wins per
// extension: a sibling `<base>.test.<ext>` / `<base>.spec.<ext>`, or a
// `__tests__/<base>.test.<ext>` / `__tests__/<base>.spec.<ext>` next to it. We
// return ALL matches (a component can carry both a .test and a .spec) as rel paths.
// ---------------------------------------------------------------------------

const TEST_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];

function findCollateralTests(appRoot, relPath) {
  const dir = dirname(relPath); // posix-ish; join handles separators
  // strip the component's own extension to get the base name.
  const file = relPath.slice(dir.length + 1);
  const base = file.replace(/\.(tsx|ts|jsx|js)$/i, '');
  const candidates = [];
  for (const kind of ['test', 'spec']) {
    for (const ext of TEST_EXTENSIONS) {
      candidates.push(join(dir, `${base}.${kind}.${ext}`));
      candidates.push(join(dir, '__tests__', `${base}.${kind}.${ext}`));
    }
  }
  const found = [];
  const seen = new Set();
  for (const rel of candidates) {
    const posix = rel.split(sep).join('/');
    if (seen.has(posix)) continue;
    if (existsSync(join(appRoot, rel))) {
      seen.add(posix);
      found.push(posix);
    }
  }
  return found;
}

// Wrap a co-located test's render output in <NextIntlClientProvider> so the
// existing assertions still mount the now-i18n'd component. Mechanical + best-
// effort: it injects the import (once) and wraps the FIRST argument of each
// `render(...)` call with the provider. When the wrap can't be applied cleanly
// (no render() call found, or already wrapped) it returns { changed:false } and
// the SKILL falls back to a manual instruction — but the test is STILL backed up
// by the caller, so rollback stays coherent either way. `messages` is left as an
// empty object literal: next-intl tolerates missing keys at render with the key
// echoed back, which keeps existing assertions on non-extracted text intact, and
// the SKILL fills real messages when it knows the namespace.
function wrapTestWithProvider(source) {
  if (/NextIntlClientProvider/.test(source)) {
    return { code: source, changed: false, reason: 'already wrapped' };
  }
  const renderRe = /\brender\(\s*(<[A-Za-z][\w.]*[\s\S]*?\/>|<[A-Za-z][\w.]*[\s\S]*?>[\s\S]*?<\/[A-Za-z][\w.]*>)/;
  if (!renderRe.test(source)) {
    return { code: source, changed: false, reason: 'no render(<JSX>) call to wrap' };
  }
  let out = source.replace(
    renderRe,
    (m, jsx) =>
      `render(\n    <NextIntlClientProvider locale="en" messages={{}} timeZone="UTC">\n      ${jsx}\n    </NextIntlClientProvider>`,
  );
  // inject the import once, after the last existing import (or at the top).
  const importLine = "import { NextIntlClientProvider } from 'next-intl';\n";
  const lastImport = [...out.matchAll(/^import .*;?\s*$/gm)].pop();
  if (lastImport) {
    const idx = lastImport.index + lastImport[0].length;
    out = out.slice(0, idx) + '\n' + importLine.trimEnd() + out.slice(idx);
  } else {
    out = importLine + out;
  }
  return { code: out, changed: true };
}

// ---------------------------------------------------------------------------
// catalog merge — NEVER lose a key. Read the existing namespaced catalog (if
// any), deep-merge the new keys under the namespace, write atomically (temp +
// rename). The catalog shape mirrors the cowpath: messages/<locale>/<NS>.json
// holds the flat key→text map for one namespace (split-by-namespace layout).
// ---------------------------------------------------------------------------

function catalogPath(appRoot, messagesDir, locale, namespace) {
  return join(appRoot, messagesDir, locale, `${namespace}.json`);
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

    // already auto-written in a prior run? skip (resumability).
    const prior = ledger.files[file];
    if (prior && prior.status === 'written' && !dryRun) {
      results.push({
        file,
        route,
        confidence,
        status: 'skipped-done',
        reason: 'already extracted in a prior run (ledger)',
        changed: false,
        keys: prior.keys || {},
        catalog: prior.catalog || null,
        backupPath: prior.backupPath || null,
      });
      continue;
    }

    // run the codemod in-process to get the rewritten source + the catalog keys.
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
    const catAbs = catalogPath(appRoot, messagesDir, sourceLocale, namespace);

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
        catalog: catAbs.split(sep).join('/'),
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
      const relStagedCatalog = join(STAGED_DIR, messagesDir, sourceLocale, `${namespace}.json`)
        .split(sep)
        .join('/');
      const relLiveCatalog = join(messagesDir, sourceLocale, `${namespace}.json`).split(sep).join('/');
      const stagedSourceAbs = join(appRoot, relStagedSource);
      const stagedCatalogAbs = join(appRoot, relStagedCatalog);
      if (!dryRun) {
        mkdirSync(dirname(stagedSourceAbs), { recursive: true });
        writeFileSync(stagedSourceAbs, out.code, 'utf8');
        // staged catalog is a fresh merge against any prior staged catalog (NOT the
        // live one — staging never touches live state).
        mergeCatalog(stagedCatalogAbs, out.keys, { overwrite: overwriteKeys });
        // record the read-back contract so `--apply-staged <file>` can promote
        // this rewrite without re-scanning / re-running the codemod.
        stagedManifest.files[file.split(sep).join('/')] = {
          liveSource: file.split(sep).join('/'),
          stagedSource: relStagedSource,
          stagedCatalog: relStagedCatalog,
          liveCatalog: relLiveCatalog,
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
        const wrapped = wrapTestWithProvider(testSrc);
        if (wrapped.changed) writeFileSync(join(appRoot, testRel), wrapped.code, 'utf8');
        testEdits.push({
          file: testRel,
          backupPath: testBackup,
          wrapped: wrapped.changed,
          reason: wrapped.changed ? 'provider-wrapped' : `not auto-wrapped (${wrapped.reason}) — wrap manually`,
        });
      }
      writeFileSync(join(appRoot, file), out.code, 'utf8');
      catalogResult = mergeCatalog(catAbs, out.keys, { overwrite: overwriteKeys });
      ledger.files[file] = {
        status: 'written',
        confidence,
        namespace,
        keys: out.keys,
        catalog: catAbs.split(sep).join('/'),
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
      catalog: catAbs.split(sep).join('/'),
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
    collateralTests: results.reduce((n, x) => n + (x.collateralTests ? x.collateralTests.length : 0), 0),
    collateralTestsWrapped: results.reduce(
      (n, x) => n + (x.testEdits ? x.testEdits.filter((t) => t.wrapped).length : 0),
      0,
    ),
    collateralTestsNeedManualWrap: results.reduce(
      (n, x) => n + (x.testEdits ? x.testEdits.filter((t) => !t.wrapped).length : 0),
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
    const wrapped = wrapTestWithProvider(testSrc);
    if (wrapped.changed) writeFileSync(join(appRoot, testRel), wrapped.code, 'utf8');
    testEdits.push({
      file: testRel,
      backupPath: testBackup,
      wrapped: wrapped.changed,
      reason: wrapped.changed ? 'provider-wrapped' : `not auto-wrapped (${wrapped.reason}) — wrap manually`,
    });
  }

  writeFileSync(join(appRoot, file), stagedCode, 'utf8');
  const liveCatalogAbs = join(appRoot, entry.liveCatalog);
  const merge = mergeCatalog(liveCatalogAbs, stagedKeys, { overwrite: overwriteKeys });

  ledger.files[key] = {
    status: 'written',
    confidence: entry.confidence,
    namespace: entry.namespace,
    keys: stagedKeys,
    catalog: entry.liveCatalog,
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
