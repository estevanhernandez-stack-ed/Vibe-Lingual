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
//
// Returns a report: { results[], summary, batchId, ledgerPath }. Each result:
//   { file, route, confidence, status, reason, changed, keys, catalog, backupPath }
//   status ∈ { 'written','staged','inline-only','skipped-done','skipped-no-change',
//              'blocked' }.
// ---------------------------------------------------------------------------

export function extract(inventory, options = {}) {
  const appRoot = options.appRoot;
  if (!appRoot) throw new Error('extract: options.appRoot is required');
  const messagesDir = options.messagesDir || DEFAULT_MESSAGES_DIR;
  const sourceLocale = options.sourceLocale || DEFAULT_SOURCE_LOCALE;
  const dryRun = !!options.dryRun;
  const overwriteKeys = !!options.overwriteKeys;

  const byFile = groupSitesByFile(inventory);
  const ready = readinessIndex(options.audit);
  const ledger = readLedger(appRoot);

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
      });
      continue;
    }

    // ---- route: stage (medium) — write the rewrite + catalog to a review mirror. ----
    if (route === 'stage') {
      const stagedSource = join(appRoot, STAGED_DIR, file);
      const stagedCatalog = join(appRoot, STAGED_DIR, messagesDir, sourceLocale, `${namespace}.json`);
      if (!dryRun) {
        mkdirSync(dirname(stagedSource), { recursive: true });
        writeFileSync(stagedSource, out.code, 'utf8');
        // staged catalog is a fresh merge against any prior staged catalog (NOT the
        // live one — staging never touches live state).
        mergeCatalog(stagedCatalog, out.keys, { overwrite: overwriteKeys });
      }
      results.push({
        file,
        route,
        confidence,
        status: 'staged',
        reason: 'medium file confidence — rewrite + catalog staged for review (live source untouched)',
        changed: true,
        keys: out.keys,
        catalog: stagedCatalog.split(sep).join('/'),
        stagedSource: stagedSource.split(sep).join('/'),
        backupPath: null,
      });
      continue;
    }

    // ---- route: auto-write (high) — backup FIRST, then write source + merge catalog. ----
    let backupPath = null;
    let catalogResult = null;
    if (!dryRun) {
      // ORDER IS LOAD-BEARING: backup → write source → merge catalog → ledger.
      backupPath = batch.backupFile(file);
      writeFileSync(join(appRoot, file), out.code, 'utf8');
      catalogResult = mergeCatalog(catAbs, out.keys, { overwrite: overwriteKeys });
      ledger.files[file] = {
        status: 'written',
        confidence,
        namespace,
        keys: out.keys,
        catalog: catAbs.split(sep).join('/'),
        backupPath,
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
  };

  return {
    results,
    summary,
    batchId: manifest ? manifest.batchId : null,
    ledgerPath: join(STATE_DIR, 'state', 'extract-ledger.json').split(sep).join('/'),
    dryRun,
  };
}

export default extract;
