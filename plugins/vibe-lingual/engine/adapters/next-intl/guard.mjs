// next-intl adapter — guard emitter (M7).
//
// Emits the ESLint `react/jsx-no-literals` override that RATCHETS fully-extracted
// files: once a file's user-facing JSX text is all in the catalog, a hardcoded
// literal sneaking back in fails the build. Modeled byte-for-byte on the proven
// Celestia3 cowpath override (eslint.config.mjs):
//
//   {
//     files: [
//       "src/components/settings/LanguageSettings.tsx",
//       "src/app/s/*/page.tsx",
//     ],
//     rules: {
//       "react/jsx-no-literals": ["error", { allowedStrings: ["·", "—", "•"] }],
//     },
//   }
//
// THE LOAD-BEARING FIX (cowpath gotcha): an ESLint flat-config `files` entry like
// `src/app/s/[shareId]/page.tsx` SILENTLY never matches — minimatch treats the
// `[shareId]` as a CHARACTER CLASS, so the rule never applies and the ratchet is a
// no-op nobody notices. Dynamic-route segments MUST be globbed with `*`:
// `src/app/s/*/page.tsx`. This emitter rewrites every `[param]` segment to `*`.
//
// SELF-VERIFY: each guarded file should actually RESOLVE the rule. The cowpath
// proof is `eslint --print-config <file>` reporting `react/jsx-no-literals` at
// 'error'. verifyGuard() shells out to the TARGET APP's eslint (where eslint
// lives — it is not a vibe-lingual dependency) and degrades gracefully when
// eslint is not resolvable: it returns a structural verdict (does the glob match
// the file, is the rule in the override) plus the command to run by hand. The
// emit step never depends on eslint being installed in the plugin.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Punctuation kept literal in JSX (the cowpath allowlist) — separators that read
// the same in every locale and would be noise as catalog keys.
export const DEFAULT_ALLOWED_STRINGS = ['·', '—', '•'];

// Rewrite a dynamic-route segment to a glob. `[shareId]` / `[...slug]` /
// `[[...opt]]` all collapse to `*` (the minimatch char-class trap fix). A normal
// path segment is returned unchanged.
function globSegment(seg) {
  return /^\[.*\]$/.test(seg) ? '*' : seg;
}

// Convert a file path to a guard-safe glob: every dynamic-route segment becomes
// `*`. Paths are normalized to POSIX separators (ESLint flat-config globs are
// POSIX even on Windows).
export function toGuardGlob(file) {
  return String(file)
    .split(/[\\/]/)
    .filter((s) => s.length > 0)
    .map(globSegment)
    .join('/');
}

// True when a file path contains a dynamic-route segment (so the glob differs
// from the literal path).
export function hasDynamicSegment(file) {
  return String(file)
    .split(/[\\/]/)
    .some((seg) => /^\[.*\]$/.test(seg));
}

// ---------------------------------------------------------------------------
// emitGuard(files, options) -> EslintOverride
//   { files: string[], rules: {...} }  — a flat-config override block. `files`
//   are globs (dynamic segments → '*'), de-duplicated + sorted for a stable diff.
// ---------------------------------------------------------------------------

export function emitGuard(files, options = {}) {
  const allowed = options.allowedStrings || DEFAULT_ALLOWED_STRINGS;
  const globs = [...new Set((files || []).map(toGuardGlob))].sort();
  return {
    files: globs,
    rules: {
      'react/jsx-no-literals': ['error', { allowedStrings: allowed }],
    },
  };
}

// Render the override as a flat-config source block (the text the SKILL splices
// into eslint.config.mjs). Mirrors the cowpath formatting exactly.
export function renderGuardBlock(override) {
  const filesLines = override.files.map((g) => `      ${JSON.stringify(g)},`).join('\n');
  const allowed = override.rules['react/jsx-no-literals'][1].allowedStrings;
  const allowedLiteral = '[' + allowed.map((s) => JSON.stringify(s)).join(', ') + ']';
  return [
    '  // VibeLingual i18n guard. Files whose user-facing JSX text has been fully extracted to message',
    '  // catalogs must not reintroduce hardcoded text. Scoped per fully-extracted file and ratcheted to',
    '  // "error". Only files with ZERO remaining literals belong here; attribute-literal detection',
    "  // (placeholder/aria-label) is owned by the plugin's scanner, not this rule.",
    '  {',
    '    files: [',
    filesLines,
    '    ],',
    '    rules: {',
    `      "react/jsx-no-literals": ["error", { allowedStrings: ${allowedLiteral} }],`,
    '    },',
    '  },',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// self-verify — `eslint --print-config <file>` reports the rule at 'error'.
// ---------------------------------------------------------------------------

// Resolve the target app's eslint binary. eslint is NOT a vibe-lingual dependency
// — it is the APP's dev tool — so we look for it under the app's node_modules.
// Returns the path to the bin, or null when not resolvable.
function resolveEslintBin(appRoot) {
  if (!appRoot) return null;
  const candidates = [
    join(appRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'eslint.cmd' : 'eslint'),
    join(appRoot, 'node_modules', 'eslint', 'bin', 'eslint.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

// Verify a single guarded file resolves react/jsx-no-literals at 'error'.
//   { file, glob, ranEslint, rule, severity, ok, command, reason }
// When eslint is resolvable in the app, runs `eslint --print-config <file>` and
// inspects the resolved rule. When not, returns a STRUCTURAL verdict (glob match +
// rule presence in the emitted override) and the command to run by hand — never
// throws, never depends on eslint being installed in the plugin.
export function verifyGuardFile(file, override, options = {}) {
  const glob = toGuardGlob(file);
  const ruleEntry = override && override.rules && override.rules['react/jsx-no-literals'];
  const structurallyGuarded =
    override && Array.isArray(override.files) && override.files.includes(glob) && !!ruleEntry;

  const appRoot = options.appRoot || null;
  const command = `eslint --print-config ${file}`;

  const bin = resolveEslintBin(appRoot);
  if (!bin) {
    return {
      file,
      glob,
      ranEslint: false,
      rule: 'react/jsx-no-literals',
      severity: ruleEntry ? severityOf(ruleEntry) : null,
      ok: structurallyGuarded,
      command,
      reason: structurallyGuarded
        ? 'eslint not resolvable in app; structural check passed (glob matches file + rule present). Run the command to confirm.'
        : 'eslint not resolvable AND the file is not covered by the override glob.',
    };
  }

  // run eslint --print-config <file> in the app and inspect the resolved rule.
  let res;
  try {
    res = spawnSync(bin, ['--print-config', file], {
      cwd: appRoot,
      encoding: 'utf8',
      shell: process.platform === 'win32', // .cmd shim needs a shell on Windows
      timeout: options.timeoutMs || 30000,
    });
  } catch (e) {
    return {
      file,
      glob,
      ranEslint: false,
      rule: 'react/jsx-no-literals',
      severity: ruleEntry ? severityOf(ruleEntry) : null,
      ok: structurallyGuarded,
      command,
      reason: `eslint invocation failed (${e.message}); fell back to structural check.`,
    };
  }

  if (res.status !== 0 || !res.stdout) {
    return {
      file,
      glob,
      ranEslint: true,
      rule: 'react/jsx-no-literals',
      severity: ruleEntry ? severityOf(ruleEntry) : null,
      ok: structurallyGuarded,
      command,
      reason: `eslint --print-config exited ${res.status}; ${(res.stderr || '').trim().slice(0, 200)}`,
    };
  }

  let resolvedSeverity = null;
  try {
    const cfg = JSON.parse(res.stdout);
    const rule = cfg && cfg.rules && cfg.rules['react/jsx-no-literals'];
    resolvedSeverity = normalizeSeverity(Array.isArray(rule) ? rule[0] : rule);
  } catch {
    resolvedSeverity = null;
  }

  const ok = resolvedSeverity === 'error';
  return {
    file,
    glob,
    ranEslint: true,
    rule: 'react/jsx-no-literals',
    severity: resolvedSeverity,
    ok,
    command,
    reason: ok
      ? 'eslint --print-config resolves react/jsx-no-literals at error for this file.'
      : `eslint --print-config resolves the rule at ${resolvedSeverity ?? 'off'} (expected error) — the glob likely does not match this file.`,
  };
}

// Verify every guarded file. Returns { override, results[], allOk }.
export function verifyGuard(files, options = {}) {
  const override = emitGuard(files, options);
  const results = (files || []).map((f) => verifyGuardFile(f, override, options));
  return { override, results, allOk: results.every((r) => r.ok) };
}

function severityOf(ruleEntry) {
  return normalizeSeverity(Array.isArray(ruleEntry) ? ruleEntry[0] : ruleEntry);
}

function normalizeSeverity(sev) {
  if (sev === 2 || sev === 'error') return 'error';
  if (sev === 1 || sev === 'warn') return 'warn';
  if (sev === 0 || sev === 'off') return 'off';
  return null;
}

export default emitGuard;
