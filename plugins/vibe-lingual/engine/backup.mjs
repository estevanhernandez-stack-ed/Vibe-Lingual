// vibe-lingual engine — per-file backup + rollback (M8).
//
// The reversibility floor under the localize mutating loop (KTD-2: confidence-
// routed + BACKED-UP + idempotent). Before extract writes a single source byte,
// it copies the original into a timestamped backup batch; rollback restores those
// originals EXACTLY (byte-for-byte). The discipline mirrors the sibling
// vibe-prompt/vibe-sec fix flow: backup → mutate → ledger entry, in that order,
// always. A mutation that skipped the backup is the one bug this module exists to
// make impossible.
//
// Layout (all paths relative to the target app root):
//
//   .vibe-lingual/localize/backup/<batchId>/        one dir per write-batch
//     <relative/source/path>                        byte-for-byte original copy
//     manifest.json                                 { batchId, createdAt, files[] }
//
//   <batchId> is an ISO-ish timestamp, filesystem-safe: YYYY-MM-DDTHH-MM-SS-mmmZ
//   (colons → dashes so it is a legal dir name on every platform, Windows included).
//
// The backup tree MIRRORS the source tree so a rollback can restore each file to
// its exact original location without a lookup table — but the manifest records
// the mapping explicitly too (source-of-truth for rollback + the dashboard).
//
// No network, no app-code execution. Pure filesystem. Reads + writes only inside
// .vibe-lingual/localize/backup/ (and, on rollback, the original source paths).

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';

const BACKUP_ROOT = join('.vibe-lingual', 'localize', 'backup');

// ---------------------------------------------------------------------------
// batch ids — a filesystem-safe ISO timestamp. The localize SKILL's --rollback
// flag takes the ORIGINAL ISO timestamp; we normalize it to the safe form so a
// user can pass either shape.
// ---------------------------------------------------------------------------

// Make an ISO timestamp safe as a directory name: replace the time-separator
// colons (and any stray colon) with dashes. '2026-06-21T14:30:05.123Z' →
// '2026-06-21T14-30-05-123Z'.
export function safeBatchId(iso) {
  return String(iso).replace(/:/g, '-').replace(/\./g, '-');
}

// A fresh batch id for "now" (or an injected clock for deterministic tests).
export function newBatchId(date = new Date()) {
  return safeBatchId(date.toISOString());
}

// Resolve a user-supplied rollback id to the on-disk batch dir name. Accepts the
// safe form as-is, or a raw ISO string (which we normalize). Returns null when no
// matching batch dir exists under the app root.
export function resolveBatchId(appRoot, idOrIso) {
  const candidates = [String(idOrIso), safeBatchId(idOrIso)];
  for (const c of candidates) {
    if (existsSync(join(appRoot, BACKUP_ROOT, c))) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// a Backup batch — accumulate file copies under one timestamped dir, then commit
// a manifest. The localize loop opens ONE batch per localize run and backs up
// each file it is about to touch into it.
// ---------------------------------------------------------------------------

export class BackupBatch {
  // appRoot: target app root. batchId: optional (defaults to now). The batch dir
  // is created lazily on the first backupFile so a no-write run leaves no trace.
  constructor(appRoot, batchId = newBatchId()) {
    this.appRoot = appRoot;
    this.batchId = batchId;
    this.dir = join(appRoot, BACKUP_ROOT, batchId);
    this.files = []; // [{ source: relPosix, backup: relPosix-under-batch }]
    this._created = false;
  }

  _ensureDir() {
    if (!this._created) {
      mkdirSync(this.dir, { recursive: true });
      this._created = true;
    }
  }

  // Back up ONE source file (relative path under appRoot) before it is mutated.
  // Copies the exact bytes into the batch dir, mirroring the source tree. Returns
  // the backup path (relative to appRoot). Idempotent per file within a batch: a
  // second backupFile of the same relPath is a no-op (the FIRST original is the
  // one we restore to — never overwrite an earlier backup with a half-mutated copy).
  backupFile(relPath) {
    const relPosix = toPosix(relPath);
    if (this.files.some((f) => f.source === relPosix)) {
      return this.files.find((f) => f.source === relPosix).backup;
    }
    const abs = join(this.appRoot, relPath);
    const bytes = readFileSync(abs); // Buffer — byte-for-byte, no encoding round-trip
    this._ensureDir();
    const dest = join(this.dir, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    const backupRel = toPosix(join(BACKUP_ROOT, this.batchId, relPath));
    this.files.push({ source: relPosix, backup: backupRel });
    return backupRel;
  }

  // Write the batch manifest. Call once after all backupFile calls. A batch that
  // backed up zero files writes no manifest + leaves no dir (nothing to restore).
  commit(extra = {}) {
    if (this.files.length === 0) return null;
    this._ensureDir();
    const manifest = {
      schemaVersion: 1,
      batchId: this.batchId,
      createdAt: new Date().toISOString(),
      appRoot: this.appRoot,
      files: this.files.map((f) => ({ source: f.source, backup: f.backup })),
      ...extra,
    };
    writeFileSync(
      join(this.dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8',
    );
    return manifest;
  }
}

// ---------------------------------------------------------------------------
// rollback — restore every file in a batch to its exact original bytes.
//   rollback(appRoot, batchIdOrIso) -> { ok, batchId, restored[], missing[], error? }
// Strategy: read the manifest (the source-of-truth mapping), copy each backed-up
// file back over its source path. A backup file that has gone missing is reported
// (never silently skipped). Restores from the BUFFER so the round-trip is exact.
// ---------------------------------------------------------------------------

export function rollback(appRoot, batchIdOrIso) {
  const batchId = resolveBatchId(appRoot, batchIdOrIso);
  if (!batchId) {
    return {
      ok: false,
      batchId: null,
      restored: [],
      missing: [],
      error: `no backup batch found for "${batchIdOrIso}" under ${BACKUP_ROOT}`,
    };
  }

  const batchDir = join(appRoot, BACKUP_ROOT, batchId);
  const manifestPath = join(batchDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      batchId,
      restored: [],
      missing: [],
      error: `batch ${batchId} has no manifest.json — cannot restore safely`,
    };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { ok: false, batchId, restored: [], missing: [], error: `manifest unreadable: ${e.message}` };
  }

  const restored = [];
  const missing = [];
  for (const entry of manifest.files || []) {
    const backupAbs = join(appRoot, entry.backup);
    if (!existsSync(backupAbs)) {
      missing.push(entry.source);
      continue;
    }
    const bytes = readFileSync(backupAbs); // Buffer — exact restore
    const sourceAbs = join(appRoot, entry.source);
    mkdirSync(dirname(sourceAbs), { recursive: true });
    writeFileSync(sourceAbs, bytes);
    restored.push(entry.source);
  }

  return {
    ok: missing.length === 0,
    batchId,
    restored,
    missing,
    error: missing.length > 0 ? `${missing.length} backup file(s) missing — partial restore` : undefined,
  };
}

// ---------------------------------------------------------------------------
// listBatches — enumerate the backup batches under an app root, newest first.
// Used by the SKILL to show the rollback menu. Each carries the manifest summary
// when readable (file count + createdAt), or a degraded entry when not.
// ---------------------------------------------------------------------------

export function listBatches(appRoot) {
  const root = join(appRoot, BACKUP_ROOT);
  if (!existsSync(root)) return [];
  const out = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) continue;
    const manifestPath = join(dir, 'manifest.json');
    let summary = { batchId: name, fileCount: null, createdAt: null, hasManifest: false };
    if (existsSync(manifestPath)) {
      try {
        const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
        summary = {
          batchId: m.batchId || name,
          fileCount: Array.isArray(m.files) ? m.files.length : null,
          createdAt: m.createdAt || null,
          hasManifest: true,
        };
      } catch {
        // unreadable manifest — keep the degraded summary
      }
    }
    out.push(summary);
  }
  // newest first (batchId is an ISO-derived string → lexicographic === chronological)
  out.sort((a, b) => String(b.batchId).localeCompare(String(a.batchId)));
  return out;
}

// POSIX-normalize a path so backup/source mappings are stable across platforms
// (the manifest is the cross-platform contract — never leak a backslash into it).
function toPosix(p) {
  return String(p).split(sep).join('/').split('\\').join('/');
}

export default { BackupBatch, rollback, listBatches, newBatchId, safeBatchId, resolveBatchId };
