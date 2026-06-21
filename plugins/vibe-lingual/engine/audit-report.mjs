// vibe-lingual engine — audit report assembly (M4).
//
// Pure function: an audit object (audit.mjs output) → a markdown report. No I/O;
// the CLI/SKILL owns writing it. Mirrors the scan brief's narrative-but-grounded
// posture — every gotcha names its file, every decision states the required-vs-
// optional flag, the phased plan reads as an ordered build script.

const SEV_LABEL = { block: 'BLOCK', warn: 'WARN', info: 'INFO' };
const SEV_ORDER = ['block', 'warn', 'info'];

const GOTCHA_TITLE = {
  'firebase-admin-ssr': 'firebase-admin in an SSR surface',
  'structural-intl': 'structural `Intl` (confirm-before-extract)',
  timezone: 'timeZone decision needed (presentational date)',
  rtl: 'RTL readiness',
  'dynamic-route-glob': 'dynamic-route ESLint glob',
};

const PHASE_LABEL = {
  extract: 'Extract',
  wire: 'Wire framework',
  translate: 'Translate',
  'wire-to-locale': 'Wire to locale',
  guard: 'Guard',
};

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function header(audit, opts) {
  const date = opts.date || isoDate();
  const root = opts.root || '(unknown root)';
  const s = audit.summary || {};
  return [
    `# i18n audit — ${root}`,
    '',
    `_Generated ${date} by vibe-lingual audit. Read-only — no source was mutated._`,
    '',
    `**${s.totalGotchas ?? audit.gotchas.length} gotcha(s)** — ` +
      `${s.blockers ?? 0} block · ${s.warnings ?? 0} warn · ${s.infos ?? 0} info. ` +
      `**${s.filesBlocked ?? 0} file(s) blocked**, ${s.filesReady ?? 0} ready. ` +
      `**${s.requiredDecisions ?? 0} REQUIRED decision(s)** to make before localizing.`,
    '',
  ].join('\n');
}

function gotchaSection(audit) {
  const lines = ['## Gotchas', ''];
  if (audit.gotchas.length === 0) {
    lines.push('_No retrofit gotchas found — clean surface._', '');
    return lines.join('\n');
  }
  for (const sev of SEV_ORDER) {
    const group = audit.gotchas.filter((g) => g.severity === sev);
    if (group.length === 0) continue;
    lines.push(`### ${SEV_LABEL[sev]} (${group.length})`, '');
    for (const g of group) {
      const loc = g.file ? `\`${g.file}${g.line ? ':' + g.line : ''}\`` : '_(app-level)_';
      lines.push(`- **${GOTCHA_TITLE[g.type] || g.type}** — ${loc}`);
      lines.push(`  - ${g.recommendation}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function decisionsSection(audit) {
  const lines = ['## Decisions to make', ''];
  if (audit.decisions.length === 0) {
    lines.push('_No per-app decisions surfaced._', '');
    return lines.join('\n');
  }
  for (const d of audit.decisions) {
    const tag = d.required ? '**REQUIRED**' : 'optional';
    lines.push(`### \`${d.id}\` (${tag})`, '');
    lines.push(d.question, '');
    lines.push('Options:');
    for (const o of d.options) lines.push(`- ${o}`);
    lines.push('');
    lines.push(`**Recommended:** ${d.recommended}`);
    if (d.rationale) lines.push(`> ${d.rationale}`);
    lines.push('');
  }
  return lines.join('\n');
}

function readinessSection(audit) {
  const lines = ['## Per-file readiness', ''];
  if (audit.readiness.length === 0) {
    lines.push('_No files with localization work._', '');
    return lines.join('\n');
  }
  lines.push('| File | Status | Sites | Reason |');
  lines.push('|---|---|---|---|');
  for (const r of audit.readiness) {
    const status = r.status === 'blocked' ? '**BLOCKED**' : 'ready';
    lines.push(`| \`${r.file}\` | ${status} | ${r.siteCount ?? ''} | ${r.reason} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function phasedPlanSection(audit) {
  const lines = ['## Phased plan', ''];
  lines.push('Arc: **extract → wire → translate → wire-to-locale → guard.**', '');
  for (const p of audit.phasedPlan) {
    lines.push(`### ${PHASE_LABEL[p.phase] || p.phase}`, '');
    if (p.items.length === 0) {
      lines.push('- _(nothing for this phase)_');
    } else {
      for (const item of p.items) lines.push(`- ${item}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function auditReport(audit, opts = {}) {
  return [
    header(audit, opts),
    gotchaSection(audit),
    decisionsSection(audit),
    readinessSection(audit),
    phasedPlanSection(audit),
  ].join('\n');
}

export default auditReport;
