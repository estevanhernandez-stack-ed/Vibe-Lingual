#!/usr/bin/env node
// vibe-lingual engine CLI — dispatch.
// `detect` + `scan` are implemented (M1, M2); the rest land in later milestones.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { detect } from './detect.mjs';
import { scan } from './scan.mjs';
import { brief } from './brief.mjs';
import { audit } from './audit.mjs';
import { auditReport } from './audit-report.mjs';

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
    '  audit <appRoot> [--inventory <path>] [--audit <path>] [--report <path>]',
    '            i18n-retrofit gotcha + per-file readiness + phased-plan analysis',
    '  extract   codemod string literals into translation calls',
    '  wire      emit framework wiring (request, locale cookie, provider, patches)',
    '  parity    emit + verify recursive key-path catalog parity',
    '  detect <appRoot>',
    '            framework + router + SSR + existing-i18n detection (JSON)',
    '',
    'scan flags:',
    '  --inventory <path>   write inventory.json here (default: stdout)',
    '  --brief <path>       write the markdown brief here (default: stdout)',
    'With neither flag, scan prints the brief to stdout and inventory JSON is omitted.',
    '',
    'audit flags:',
    '  --inventory <path>   read a cached inventory.json here (skips re-scan).',
    '                       Omit to run detect+scan on <appRoot> first.',
    '  --audit <path>       write audit.json here (default: stdout)',
    '  --report <path>      write the markdown audit report here (default: stdout)',
    'With neither --audit nor --report, audit prints the report to stdout.',
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
  let inventory;
  if (typeof args.inventory === 'string') {
    try {
      inventory = JSON.parse(readFileSync(args.inventory, 'utf8'));
    } catch (e) {
      console.error(`vibe-lingual audit: cannot read inventory at ${args.inventory}: ${e.message}`);
      return 1;
    }
  } else {
    inventory = scan(root, detect(root));
  }

  // `root` enables the firebase-admin-SSR rule (the only source-dependent check).
  // When the inventory carries its own app.root, prefer that — it is the tree the
  // inventory's ssrFiles are relative to. Fall back to the positional root.
  const appRoot = (inventory.app && inventory.app.root) || root;
  const result = audit(inventory, appRoot);
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

  console.log(`vibe-lingual ${sub}: not yet implemented`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
