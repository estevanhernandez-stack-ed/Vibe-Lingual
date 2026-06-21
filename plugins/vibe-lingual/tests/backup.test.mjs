// M8 — backup + rollback tests.
//
// The reversibility floor under the localize loop. Asserts:
//   - a BackupBatch copies a file's exact bytes into a timestamped batch dir,
//     mirroring the source tree, and writes a manifest.
//   - rollback restores the original bytes EXACTLY (byte-for-byte, including a
//     trailing-newline / CRLF the codemod would otherwise normalize).
//   - rollback by raw ISO timestamp OR by safe batch id both resolve.
//   - a batch that backed up nothing leaves no manifest (no-op runs are clean).
//   - listBatches enumerates batches newest-first with the manifest summary.
//
// Each test builds an isolated temp app tree under os.tmpdir() so the mutating
// paths never touch the repo or a fixture.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BackupBatch,
  rollback,
  listBatches,
  safeBatchId,
  resolveBatchId,
} from '../engine/backup.mjs';

function freshApp() {
  const root = mkdtempSync(join(tmpdir(), 'vl-backup-'));
  mkdirSync(join(root, 'src', 'components'), { recursive: true });
  return root;
}

describe('BackupBatch — copies exact bytes + writes a manifest', () => {
  let root;
  beforeEach(() => {
    root = freshApp();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('backupFile mirrors the source tree under the batch dir', () => {
    const rel = 'src/components/Card.tsx';
    const original = '"use client";\nexport const x = "Hello";\n';
    writeFileSync(join(root, rel), original, 'utf8');

    const batch = new BackupBatch(root, '2026-06-21T10-00-00-000Z');
    const backupRel = batch.backupFile(rel);

    expect(backupRel).toBe('.vibe-lingual/localize/backup/2026-06-21T10-00-00-000Z/src/components/Card.tsx');
    expect(existsSync(join(root, backupRel))).toBe(true);
    // exact bytes preserved
    expect(readFileSync(join(root, backupRel), 'utf8')).toBe(original);
  });

  test('commit writes a manifest naming every backed-up file', () => {
    const rel = 'src/components/Card.tsx';
    writeFileSync(join(root, rel), 'const a = 1;\n', 'utf8');
    const batch = new BackupBatch(root, '2026-06-21T10-00-00-000Z');
    batch.backupFile(rel);
    const manifest = batch.commit({ trigger: 'test' });

    expect(manifest.batchId).toBe('2026-06-21T10-00-00-000Z');
    expect(manifest.trigger).toBe('test');
    expect(manifest.files).toEqual([
      {
        source: 'src/components/Card.tsx',
        backup: '.vibe-lingual/localize/backup/2026-06-21T10-00-00-000Z/src/components/Card.tsx',
      },
    ]);
  });

  test('a second backupFile of the same path is a no-op (keeps the FIRST original)', () => {
    const rel = 'a.tsx';
    writeFileSync(join(root, rel), 'ORIGINAL', 'utf8');
    const batch = new BackupBatch(root, '2026-06-21T10-00-00-000Z');
    batch.backupFile(rel);
    // simulate a mutation, then a buggy re-backup attempt
    writeFileSync(join(root, rel), 'MUTATED', 'utf8');
    batch.backupFile(rel);
    const backupRel = '.vibe-lingual/localize/backup/2026-06-21T10-00-00-000Z/a.tsx';
    // the backup must still hold the ORIGINAL, never the mutated copy
    expect(readFileSync(join(root, backupRel), 'utf8')).toBe('ORIGINAL');
    expect(batch.files.length).toBe(1);
  });

  test('a batch that backed up nothing writes no manifest + leaves no dir', () => {
    const batch = new BackupBatch(root, '2026-06-21T10-00-00-000Z');
    const manifest = batch.commit();
    expect(manifest).toBeNull();
    expect(existsSync(join(root, '.vibe-lingual/localize/backup/2026-06-21T10-00-00-000Z'))).toBe(false);
  });
});

describe('rollback — restores the original bytes EXACTLY', () => {
  let root;
  beforeEach(() => {
    root = freshApp();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('round-trips a mutated file back to its byte-for-byte original', () => {
    const rel = 'src/components/Card.tsx';
    // an original with a CRLF + trailing newline — the exact shape a codemod's
    // recast pass would normalize away. Rollback must restore it verbatim.
    const original = '"use client";\r\nexport const greeting = "Welcome";\r\n';
    writeFileSync(join(root, rel), original, 'utf8');

    const batch = new BackupBatch(root, '2026-06-21T10-00-00-000Z');
    batch.backupFile(rel);
    batch.commit();

    // mutate the file (as extract would)
    writeFileSync(join(root, rel), "const t = useTranslations('Card');\n", 'utf8');
    expect(readFileSync(join(root, rel), 'utf8')).not.toBe(original);

    const res = rollback(root, '2026-06-21T10-00-00-000Z');
    expect(res.ok).toBe(true);
    expect(res.restored).toEqual(['src/components/Card.tsx']);
    // EXACT restore — CRLF + trailing newline intact
    expect(readFileSync(join(root, rel), 'utf8')).toBe(original);
  });

  test('rollback resolves by raw ISO timestamp as well as the safe batch id', () => {
    const rel = 'a.tsx';
    writeFileSync(join(root, rel), 'ORIGINAL\n', 'utf8');
    const iso = '2026-06-21T11:22:33.444Z';
    const batch = new BackupBatch(root, safeBatchId(iso));
    batch.backupFile(rel);
    batch.commit();
    writeFileSync(join(root, rel), 'MUTATED\n', 'utf8');

    // pass the RAW ISO (with colons) — resolveBatchId normalizes it
    const res = rollback(root, iso);
    expect(res.ok).toBe(true);
    expect(readFileSync(join(root, rel), 'utf8')).toBe('ORIGINAL\n');
  });

  test('rollback of a non-existent batch fails loud (ok:false + error)', () => {
    const res = rollback(root, '1999-01-01T00-00-00-000Z');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no backup batch found/);
  });
});

describe('listBatches — newest first with manifest summary', () => {
  let root;
  beforeEach(() => {
    root = freshApp();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('enumerates committed batches newest-first', () => {
    writeFileSync(join(root, 'a.tsx'), 'a\n', 'utf8');
    writeFileSync(join(root, 'b.tsx'), 'b\n', 'utf8');

    const older = new BackupBatch(root, '2026-06-20T10-00-00-000Z');
    older.backupFile('a.tsx');
    older.commit();
    const newer = new BackupBatch(root, '2026-06-21T10-00-00-000Z');
    newer.backupFile('b.tsx');
    newer.commit();

    const batches = listBatches(root);
    expect(batches.length).toBe(2);
    expect(batches[0].batchId).toBe('2026-06-21T10-00-00-000Z'); // newest first
    expect(batches[1].batchId).toBe('2026-06-20T10-00-00-000Z');
    expect(batches[0].fileCount).toBe(1);
    expect(batches[0].hasManifest).toBe(true);
  });

  test('an app with no backup dir lists nothing', () => {
    expect(listBatches(root)).toEqual([]);
  });
});

describe('resolveBatchId', () => {
  let root;
  beforeEach(() => {
    root = freshApp();
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('returns null when no batch dir exists', () => {
    expect(resolveBatchId(root, '2026-06-21T10-00-00-000Z')).toBeNull();
  });
});
