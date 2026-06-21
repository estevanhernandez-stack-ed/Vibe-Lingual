#!/usr/bin/env node
// vibe-lingual engine CLI — dispatch.
// `detect`, `scan`, `audit` (M1-M4), plus the M8 write side: `extract`, `wire`,
// `parity`. The write subcommands run the localize loop's deterministic pieces;
// the SKILL drives the soft decisions + confidence-gate around them.

import { writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { detect } from './detect.mjs';
import { scan } from './scan.mjs';
import { brief } from './brief.mjs';
import { audit } from './audit.mjs';
import { auditReport } from './audit-report.mjs';
import { extract, promoteStaged } from './extract.mjs';
import { rollback as rollbackBatch } from './backup.mjs';
import { resolveAdapter } from './adapters/index.mjs';
import { verifyParity } from './parity.mjs';

const SUBCOMMANDS = ['scan', 'audit', 'extract', 'wire', 'parity', 'detect'];

function usage() {
  return [
    'vibe-lingual — i18n/localization engine',
    '',
    'Usage: vibe-lingual <subcommand> [options]',
    '',
    'Subcommands:',
    '  scan <appRoot> [--inventory <path>] [--brief <path>]',
    '            inventory user-facing strings by kind + emit the six-block brief',
    '  audit <appRoot> --inventory <path> [--audit <path>] [--report <path>]',
    '            i18n-retrofit gotcha + per-file readiness + phased-plan analysis',
    '  extract <appRoot> --inventory <path> [--audit <path>] [options]',
    '            run the confidence-routed codemod over the inventory file set',
    '            (--stage-all forces every file to staging; --apply-staged <file>',
    '            promotes one staged rewrite to live source with backup)',
    '  wire <appRoot> [--locales a,b,c] [--source-locale en]',
    '            emit the next-intl wiring plan (request, locale cookie, patches)',
    '  parity <appRoot> --messages <dir> [--source-locale en]',
    '            verify recursive key-path catalog parity across locales',
    '  detect <appRoot>',
    '            framework + router + SSR + existing-i18n detection (JSON)',
    '',
    'scan flags:',
    '  --inventory <path>   write inventory.json here (default: stdout)',
    '  --brief <path>       write the markdown brief here (default: stdout)',
    'With neither flag, scan prints the brief to stdout and inventory JSON is omitted.',
    '',
    'audit flags:',
    '  --inventory <path>   read a cached inventory.json here. REQUIRED — audit',
    '                       reads the cached inventory; it does NOT re-scan.',
    '  --audit <path>       write audit.json here (default: stdout)',
    '  --report <path>      write the markdown audit report here (default: stdout)',
    'With neither --audit nor --report, audit prints the report to stdout.',
    '',
    'extract flags:',
    '  --inventory <path>   read the cached inventory.json. REQUIRED.',
    '  --audit <path>       read the cached audit.json (its readiness blocks auto-write).',
    '  --messages <dir>     catalog dir, relative to <appRoot> (default: messages).',
    '  --source-locale <c>  locale the catalogs are written under (default: en).',
    '  --dry-run            plan + route every file, write NOTHING (preview).',
    '  --stage-all          force EVERY file to staging regardless of confidence',
    '                       (the cautious first pass — even high-confidence files stage).',
    '  --apply-staged <f>   promote ONE staged rewrite (live rel path) from the staged',
    '                       mirror to live source, backed up first. Reversible by batch.',
    '  --rollback <id>      restore a prior backup batch (ISO timestamp or batch id).',
    '',
    'wire flags:',
    '  --locales a,b,c      explicit UI locale set (default: reuse detected list / [en]).',
    '  --source-locale <c>  the source locale, forced first (default: en).',
    '',
    'parity flags:',
    '  --messages <dir>     the catalog dir to verify (default: messages).',
    '  --source-locale <c>  the source-of-truth locale (default: first found).',
  ].join('\n');
}

// minimal flag parser: returns { _: positionals, ...named }
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next != null && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function writeOut(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

function runScan(argv) {
  const args = parseArgs(argv);
  const root = args._[0] || process.cwd();

  const detection = detect(root);
  const inventory = scan(root, detection);
  const md = brief(inventory);

  const wantInventory = typeof args.inventory === 'string';
  const wantBrief = typeof args.brief === 'string';

  if (wantInventory) {
    writeOut(args.inventory, JSON.stringify(inventory, null, 2) + '\n');
  }
  if (wantBrief) {
    writeOut(args.brief, md);
  }

  if (!wantInventory && !wantBrief) {
    // default: brief to stdout
    process.stdout.write(md + '\n');
  } else {
    const total = inventory.sites.length;
    const excluded = inventory.sites.filter((s) => s.excluded).length;
    const parts = [];
    if (wantInventory) parts.push(`inventory → ${args.inventory}`);
    if (wantBrief) parts.push(`brief → ${args.brief}`);
    console.error(
      `vibe-lingual scan: ${total} site(s) (${excluded} structural excluded) across ${inventory.componentsByDensity.length} file(s). ${parts.join(', ')}`,
    );
  }
  return 0;
}

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function runAudit(argv) {
  const args = parseArgs(argv);
  const root = args._[0] || process.cwd();

  // inventory source: a cached path (skip re-scan) or a fresh detect+scan.
  // HARDENED (M8): audit reads the cached inventory; a missing/empty/invalid
  // inventory FAILS LOUD (non-zero exit + a clear message) instead of silently
  // running detect+scan or emitting an RTL-only report off an empty surface.
  let inventory;
  if (typeof args.inventory === 'string') {
    inventory = loadInventoryOrDie('audit', args.inventory);
    if (inventory == null) return 2;
  } else {
    inventory = scan(root, detect(root));
  }

  // `root` enables the firebase-admin-SSR rule (the only source-dependent check).
  // When the inventory carries its own app.root, prefer that — it is the tree the
  // inventory's ssrFiles are relative to. Fall back to the positional root.
  const appRoot = (inventory.app && inventory.app.root) || root;
  let result;
  try {
    result = audit(inventory, appRoot);
  } catch (e) {
    // the engine fails loud on an empty/malformed inventory — surface it as a
    // clean non-zero exit rather than a stack trace.
    console.error(`vibe-lingual audit: ${e.message}`);
    return 2;
  }
  const md = auditReport(result, { root: appRoot, date: isoDate() });

  const wantAudit = typeof args.audit === 'string';
  const wantReport = typeof args.report === 'string';

  if (wantAudit) writeOut(args.audit, JSON.stringify(result, null, 2) + '\n');
  if (wantReport) writeOut(args.report, md);

  if (!wantAudit && !wantReport) {
    process.stdout.write(md + '\n');
  } else {
    const s = result.summary;
    const parts = [];
    if (wantAudit) parts.push(`audit → ${args.audit}`);
    if (wantReport) parts.push(`report → ${args.report}`);
    console.error(
      `vibe-lingual audit: ${s.totalGotchas} gotcha(s) (${s.blockers} block, ${s.warnings} warn, ${s.infos} info), ` +
        `${s.filesBlocked} file(s) blocked / ${s.filesReady} ready, ${s.requiredDecisions} required decision(s). ${parts.join(', ')}`,
    );
  }
  return 0;
}

// ---------------------------------------------------------------------------
// FAIL-LOUD inventory loader (M8 hardening). A command that reads a cached
// inventory must NOT degrade silently when it is missing, unreadable, or empty —
// it must say exactly what is wrong and stop. Returns the parsed inventory, or
// null after printing a clear error (callers turn null into a non-zero exit).
// "Empty" = no inventory file, OR a parsed object with zero `sites` AND zero
// `componentsByDensity` (nothing to localize — running on it yields a vacuous
// report, the exact silent-failure the cowpath warned about).
// ---------------------------------------------------------------------------
function loadInventoryOrDie(cmd, invPath) {
  if (!existsSync(invPath)) {
    console.error(
      `vibe-lingual ${cmd}: no inventory at "${invPath}". ` +
        `Run \`vibe-lingual scan <appRoot> --inventory ${invPath}\` first.`,
    );
    return null;
  }
  let inv;
  try {
    inv = JSON.parse(readFileSync(invPath, 'utf8'));
  } catch (e) {
    console.error(`vibe-lingual ${cmd}: inventory at "${invPath}" is not valid JSON: ${e.message}`);
    return null;
  }
  if (!inv || typeof inv !== 'object') {
    console.error(`vibe-lingual ${cmd}: inventory at "${invPath}" did not parse to an object.`);
    return null;
  }
  const sites = Array.isArray(inv.sites) ? inv.sites : null;
  const density = Array.isArray(inv.componentsByDensity) ? inv.componentsByDensity : null;
  if (sites == null || density == null) {
    console.error(
      `vibe-lingual ${cmd}: inventory at "${invPath}" is malformed ` +
        `(missing sites[] / componentsByDensity[]). Re-run scan to regenerate it.`,
    );
    return null;
  }
  if (sites.length === 0 && density.length === 0) {
    console.error(
      `vibe-lingual ${cmd}: inventory at "${invPath}" is EMPTY — zero string sites and ` +
        `zero files with localizable work. Nothing to do; re-run scan against the right app root.`,
    );
    return null;
  }
  return inv;
}

function parseLocales(v) {
  if (typeof v !== 'string') return null;
  const list = v.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : null;
}

function runExtract(argv) {
  const args = parseArgs(argv);
  const root = args._[0] || process.cwd();

  // --rollback short-circuits everything else: restore a prior backup batch.
  if (typeof args.rollback === 'string') {
    const res = rollbackBatch(root, args.rollback);
    if (!res.ok) {
      console.error(`vibe-lingual extract --rollback: ${res.error}`);
      console.log(JSON.stringify(res, null, 2));
      return 1;
    }
    console.error(
      `vibe-lingual extract: rolled back batch ${res.batchId} — ` +
        `${res.restored.length} file(s) restored.`,
    );
    console.log(JSON.stringify(res, null, 2));
    return 0;
  }

  // --apply-staged <file> short-circuits too: promote ONE staged rewrite to live
  // source (backed up first). Mirrors the sibling /vibe-prompt:remediate
  // --apply-pending — the staged-promotion path is backed at the CLI layer, not
  // left as a dead-end mirror the SKILL claims is promotable.
  if (typeof args['apply-staged'] === 'string') {
    const res = promoteStaged(root, args['apply-staged'], {
      overwriteKeys: args['overwrite-keys'] === true,
    });
    if (!res.ok) {
      console.error(`vibe-lingual extract --apply-staged: ${res.error}`);
      console.log(JSON.stringify(res, null, 2));
      return 1;
    }
    const wrapped = res.testEdits.filter((t) => t.wrapped).length;
    const manual = res.testEdits.length - wrapped;
    console.error(
      `vibe-lingual extract: promoted ${res.file} → live source — ` +
        `${res.keysMerged.added} key(s) added (${res.keysMerged.kept} kept), ` +
        `backup batch ${res.batchId}.` +
        (res.testEdits.length
          ? ` ${wrapped} test(s) wrapped${manual ? `, ${manual} need a manual wrap` : ''}.`
          : ''),
    );
    console.log(JSON.stringify(res, null, 2));
    return 0;
  }

  if (typeof args.inventory !== 'string') {
    console.error('vibe-lingual extract: --inventory <path> is required.');
    return 2;
  }
  const inventory = loadInventoryOrDie('extract', args.inventory);
  if (inventory == null) return 2;

  let auditObj = null;
  if (typeof args.audit === 'string') {
    if (!existsSync(args.audit)) {
      console.error(`vibe-lingual extract: --audit "${args.audit}" not found.`);
      return 2;
    }
    try {
      auditObj = JSON.parse(readFileSync(args.audit, 'utf8'));
    } catch (e) {
      console.error(`vibe-lingual extract: audit at "${args.audit}" is not valid JSON: ${e.message}`);
      return 2;
    }
  }

  const appRoot = (inventory.app && inventory.app.root) || root;
  const report = extract(inventory, {
    appRoot,
    audit: auditObj,
    messagesDir: typeof args.messages === 'string' ? args.messages : undefined,
    sourceLocale: typeof args['source-locale'] === 'string' ? args['source-locale'] : undefined,
    dryRun: args['dry-run'] === true,
    overwriteKeys: args['overwrite-keys'] === true,
    stageAll: args['stage-all'] === true,
  });

  const s = report.summary;
  console.error(
    `vibe-lingual extract${report.dryRun ? ' (dry-run)' : ''}: ${s.files} file(s) — ` +
      `${s.written} written${s.partial ? ` (${s.partial} partial)` : ''} · ${s.staged} staged · ` +
      `${s.inlineOnly} inline-only · ` +
      `${s.blocked} blocked · ${s.skippedDone + s.skippedNoChange} skipped · ` +
      `${s.keysWritten} key(s) written` +
      (s.sitesInline ? ` · ${s.sitesInline} site(s) left inline.` : '.') +
      (s.collateralTests
        ? ` ${s.collateralTests} co-located test(s): ${s.collateralTestsWrapped} wrapped` +
          (s.collateralTestsNeedManualWrap ? `, ${s.collateralTestsNeedManualWrap} need a manual wrap` : '') +
          '.'
        : '') +
      (report.batchId ? ` Backup batch ${report.batchId}.` : ''),
  );
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

function runWire(argv) {
  const args = parseArgs(argv);
  const root = args._[0] || process.cwd();

  const detection = detect(root);
  const resolved = resolveAdapter(detection);
  if (!resolved.adapter) {
    console.error(
      `vibe-lingual wire: no adapter for framework "${resolved.framework}" ` +
        `(status: ${resolved.status}). Only next-intl (App Router) is implemented in v1.`,
    );
    console.log(JSON.stringify(resolved, null, 2));
    return 1;
  }

  const ctx = {
    detection,
    locales: parseLocales(args.locales),
    sourceLocale: typeof args['source-locale'] === 'string' ? args['source-locale'] : undefined,
  };
  const wired = resolved.adapter.wire(ctx);

  console.error(
    `vibe-lingual wire: ${resolved.adapter.id} — ${wired.files.length} file(s), ` +
      `${wired.patches.length} patch(es), ${wired.notes.length} note(s).`,
  );
  console.log(JSON.stringify(wired, null, 2));
  return 0;
}

function runParity(argv) {
  const args = parseArgs(argv);
  const root = args._[0] || process.cwd();
  const messagesDir = typeof args.messages === 'string' ? args.messages : 'messages';
  const absMessages = join(root, messagesDir);

  if (!existsSync(absMessages)) {
    console.error(`vibe-lingual parity: messages dir not found at "${absMessages}".`);
    return 2;
  }

  // Load every catalog. Two supported layouts: messages/<locale>.json (flat) or
  // messages/<locale>/*.json (split-by-namespace). For the split layout we merge
  // each locale's namespace files into one object so the key-path walk is uniform.
  const catalogs = loadCatalogs(absMessages);
  const codes = Object.keys(catalogs);
  if (codes.length < 2) {
    console.error(
      `vibe-lingual parity: need at least 2 locale catalogs to compare; found ${codes.length} ` +
        `(${codes.join(', ') || 'none'}) under ${absMessages}.`,
    );
    return 2;
  }

  const sourceLocale = typeof args['source-locale'] === 'string' ? args['source-locale'] : undefined;
  const report = verifyParity(catalogs, sourceLocale ? { sourceLocale } : {});

  const driftLocales = Object.entries(report.perLocale)
    .filter(([, v]) => !v.ok)
    .map(([c, v]) => `${c}(+${v.extra.length}/-${v.missing.length})`);
  console.error(
    `vibe-lingual parity: ${report.ok ? 'OK' : 'DRIFT'} — source ${report.sourceLocale}, ` +
      `${report.base.length} key(s); ${codes.length} locale(s).` +
      (driftLocales.length ? ` Drift: ${driftLocales.join(', ')}.` : ''),
  );
  console.log(JSON.stringify(report, null, 2));
  return report.ok ? 0 : 1;
}

// Load locale catalogs from a messages dir into { locale: mergedObject }.
function loadCatalogs(absMessages) {
  const out = {};
  for (const name of readdirSync(absMessages)) {
    const full = join(absMessages, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // split-by-namespace: messages/<locale>/<NS>.json → merge under namespace.
      const locale = name;
      const merged = {};
      for (const f of readdirSync(full)) {
        if (!f.endsWith('.json')) continue;
        const ns = f.replace(/\.json$/, '');
        try {
          merged[ns] = JSON.parse(readFileSync(join(full, f), 'utf8'));
        } catch {
          /* skip unreadable */
        }
      }
      out[locale] = merged;
    } else if (name.endsWith('.json')) {
      // flat: messages/<locale>.json
      const locale = name.replace(/\.json$/, '');
      try {
        out[locale] = JSON.parse(readFileSync(full, 'utf8'));
      } catch {
        /* skip unreadable */
      }
    }
  }
  return out;
}

function main(argv) {
  const [sub] = argv;

  if (!sub || sub === '--help' || sub === '-h') {
    console.log(usage());
    return 0;
  }

  if (!SUBCOMMANDS.includes(sub)) {
    console.error(`vibe-lingual: unknown subcommand "${sub}"`);
    console.error('');
    console.error(usage());
    return 1;
  }

  if (sub === 'detect') {
    const args = parseArgs(argv.slice(1));
    const root = args._[0] || process.cwd();
    console.log(JSON.stringify(detect(root), null, 2));
    return 0;
  }

  if (sub === 'scan') {
    return runScan(argv.slice(1));
  }

  if (sub === 'audit') {
    return runAudit(argv.slice(1));
  }

  if (sub === 'extract') {
    return runExtract(argv.slice(1));
  }

  if (sub === 'wire') {
    return runWire(argv.slice(1));
  }

  if (sub === 'parity') {
    return runParity(argv.slice(1));
  }

  console.log(`vibe-lingual ${sub}: not yet implemented`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
