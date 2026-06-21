#!/usr/bin/env node
// vibe-lingual engine CLI — dispatch stub (M0).
// Real subcommand implementations land in later milestones (M1+).

const SUBCOMMANDS = ['scan', 'audit', 'extract', 'wire', 'parity', 'detect'];

function usage() {
  return [
    'vibe-lingual — i18n/localization engine',
    '',
    'Usage: vibe-lingual <subcommand> [options]',
    '',
    'Subcommands:',
    '  scan      inventory user-facing strings by kind',
    '  audit     i18n-retrofit gotcha + readiness analysis',
    '  extract   codemod string literals into translation calls',
    '  wire      emit framework wiring (request, locale cookie, provider, patches)',
    '  parity    emit + verify recursive key-path catalog parity',
    '  detect    framework + router + SSR + existing-i18n detection',
  ].join('\n');
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

  console.log(`vibe-lingual ${sub}: not yet implemented`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
