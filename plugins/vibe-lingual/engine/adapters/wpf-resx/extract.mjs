// wpf-resx adapter — extractXaml(): the write-side of the WPF localize loop.
//
// Drives the transform over every XAML file the inventory names, under the
// engine's reversibility floor (KTD-2): each mutated file is backed up into one
// timestamped batch BEFORE its first write; the neutral resx catalog is merged
// idempotently (re-runs add nothing); per-culture catalogs are seeded with the
// full key set (source values as placeholders for the translator). Sites the
// transform cannot rewrite mechanically are STAGED in the report, never guessed.
//
//   extractXaml(appRoot, inventory, options)
//     options.clrNamespace  REQUIRED — designer-class namespace for xmlns:loc
//     options.resxDir       default 'Properties' (relative to the app project)
//     options.projectDir    default '' — app project dir relative to appRoot;
//                           the resx lands at <projectDir>/<resxDir>/Strings.resx
//     options.locales       optional ['fr','de',…] — seed per-culture catalogs
//     options.dryRun        plan + report, write NOTHING
//
// Returns { filesChanged, entriesAdded, staged, batchId, resxPath, report }.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { BackupBatch } from '../../backup.mjs';
import { transformXamlSource } from './transform.mjs';
import { emitResx, parseResx, mergeResxEntries, KeyRegistry } from './resx.mjs';

export function extractXaml(appRoot, inventory, options = {}) {
  const { clrNamespace } = options;
  if (!clrNamespace) throw new Error('wpf-resx extract: options.clrNamespace is required');
  const resxDir = options.resxDir || 'Properties';
  const projectDir = options.projectDir || '';
  const resourceClass = options.resourceClass || 'Strings';
  const locales = Array.isArray(options.locales) ? options.locales : [];
  const dryRun = !!options.dryRun;

  const resxRel = join(projectDir, resxDir, `${resourceClass}.resx`).replace(/\\/g, '/');
  const resxAbs = join(appRoot, resxRel);

  // Idempotency across runs: seed the registry + merge base from the existing catalog.
  const existingEntries = existsSync(resxAbs) ? parseResx(readFileSync(resxAbs, 'utf8')) : [];
  const registry = new KeyRegistry();
  registry.seedUsed(existingEntries.map((e) => e.key));

  const files = [...new Set(inventory.sites.map((s) => s.file))].sort();
  const batch = new BackupBatch(appRoot);
  const perFile = [];
  const allEntries = [];
  const staged = [];
  let filesChanged = 0;

  for (const rel of files) {
    const abs = join(appRoot, rel.replace(/\//g, '/'));
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      perFile.push({ file: rel, changed: false, error: 'unreadable' });
      continue;
    }
    const result = transformXamlSource(text, rel, {
      clrNamespace,
      registry,
      resourceClass,
      xmlnsPrefix: options.xmlnsPrefix || 'loc',
    });
    staged.push(...result.staged);
    if (!result.changed) {
      perFile.push({ file: rel, changed: false, sites: 0, staged: result.staged.length });
      continue;
    }
    allEntries.push(...result.entries);
    if (!dryRun) {
      batch.backupFile(rel);
      writeFileSync(abs, result.newText, 'utf8');
    }
    filesChanged += 1;
    perFile.push({ file: rel, changed: true, sites: result.entries.length, staged: result.staged.length });
  }

  // Merge entries into the neutral catalog. keyRemap is applied nowhere else —
  // the transform minted keys through a registry already seeded with existing
  // keys, so remaps only occur for value-reuse (same text already catalogued),
  // which is exactly the dedupe we want in the resx; the XAML then references
  // the minted key, so on value-reuse we must keep BOTH keys addressable.
  // Simplest honest resolution: on value-reuse, keep the minted key as its own
  // entry too (duplicate values, distinct keys) — x:Static needs every
  // referenced key to exist.
  const merged = mergeResxEntries(existingEntries, allEntries);
  for (const [wanted, actual] of merged.keyRemap) {
    if (wanted !== actual) {
      merged.entries.push({ key: wanted, value: allEntries.find((e) => e.key === wanted)?.value ?? '', comment: 'duplicate value; key kept addressable for x:Static' });
      merged.added += 1;
    }
  }

  const localeFiles = [];
  if (!dryRun && (filesChanged > 0 || existingEntries.length === 0)) {
    if (existsSync(resxAbs)) batch.backupFile(resxRel);
    else batch.recordCreatedCatalog(resxRel);
    mkdirSync(dirname(resxAbs), { recursive: true });
    writeFileSync(resxAbs, emitResx(merged.entries), 'utf8');

    for (const locale of locales) {
      const locRel = join(projectDir, resxDir, `${resourceClass}.${locale}.resx`).replace(/\\/g, '/');
      const locAbs = join(appRoot, locRel);
      const existing = existsSync(locAbs) ? parseResx(readFileSync(locAbs, 'utf8')) : [];
      const byKey = new Map(existing.map((e) => [e.key, e]));
      // seed missing keys with the SOURCE value — the translator's worklist;
      // never overwrite a translated value.
      for (const e of merged.entries) {
        if (!byKey.has(e.key)) byKey.set(e.key, { key: e.key, value: e.value, comment: 'TODO translate' });
      }
      if (existsSync(locAbs)) batch.backupFile(locRel);
      else batch.recordCreatedCatalog(locRel);
      writeFileSync(locAbs, emitResx([...byKey.values()]), 'utf8');
      localeFiles.push(locRel);
    }
  }

  const manifest = dryRun ? null : batch.commit({ tool: 'wpf-resx extract' });

  return {
    dryRun,
    filesChanged,
    entriesAdded: merged.added,
    totalEntries: merged.entries.length,
    staged,
    batchId: manifest ? batch.batchId : null,
    resxPath: resxRel,
    localeFiles,
    report: perFile,
  };
}

export default extractXaml;
