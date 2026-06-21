#!/usr/bin/env node
// vibe-lingual engine CLI — dispatch.
// `detect` + `scan` are implemented (M1, M2); the rest land in later milestones.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { detect } from './detect.mjs';
import { scan } from './scan.mjs';
import { brief } from './brief.mjs';

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
    '  audit     i18n-retrofit gotcha + readiness analysis',
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

  console.log(`vibe-lingual ${sub}: not yet implemented`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
