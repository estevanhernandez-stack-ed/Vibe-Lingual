// vibe-lingual engine — ignore-pattern respect (Phase-3 hardening).
//
// Pure read. Builds an ignore matcher for a target app so the scanner's file walk
// auto-excludes files the APP itself already treats as out of scope — without the
// operator having to hand-prune the inventory (Phase 2 had to MANUALLY exclude
// Celestia3's legacy/ dead code, an eslint-ignored separate-package tree).
//
// Three ignore SIGNALS are read, in addition to the built-in non-source defaults:
//   1. .gitignore             — standard gitignore-syntax lines.
//   2. .eslintignore          — same gitignore syntax (legacy eslint ignore file).
//   3. eslint.config.{js,mjs,cjs,ts}  — the flat-config `globalIgnores([...])`
//      glob list (the modern replacement for .eslintignore). On Celestia3 this is
//      where `legacy/**` and `functions/**` live.
//
// CONSERVATIVE BY DESIGN. This is a deterministic, dependency-light matcher — it
// does NOT pull in `ignore`/`minimatch`. It covers the gitignore + flat-config
// shapes that actually occur in the estate (dir prefixes, `**` globs, `*` segment
// wildcards, leading-slash anchors, trailing-slash dir markers, `#` comments,
// blank lines, `!` negations). Anything it cannot parse is SKIPPED, never thrown:
// an unreadable/garbled ignore file falls back to the built-in defaults so the
// scan never crashes on a malformed config. The built-in default exclude list
// (node_modules/.next/dist/build/legacy/functions + the scanner's SKIP_DIRS) is
// ALWAYS applied even when no ignore file is found.

import { readFileSync, existsSync } from 'node:fs';
import { join, sep } from 'node:path';

// ---------------------------------------------------------------------------
// built-in defaults — always excluded, ignore-file or not. node_modules/.next/
// dist/build are non-source by construction; legacy/ + functions/ are the
// documented Celestia3 fall-back excludes (a separate package + dead code) so a
// missing/unparseable eslint config still keeps them out of the inventory.
// ---------------------------------------------------------------------------

export const DEFAULT_EXCLUDE_DIRS = [
  'node_modules',
  '.next',
  '.git',
  'dist',
  'build',
  'coverage',
  'out',
  'legacy',
  'functions',
];

const ESLINT_CONFIG_FILES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
];

function toPosix(p) {
  return String(p).split('\\').join('/').split(sep).join('/');
}

function readText(absPath) {
  try {
    return readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// pattern compilation. A gitignore/flat-config glob becomes a { negate, test }
// rule whose test(relPosix) reports whether the path is matched. relPosix is the
// app-root-relative POSIX path of a FILE (never trailing-slash). Directory
// patterns match a file by matching any of its ancestor path prefixes.
// ---------------------------------------------------------------------------

// Translate one gitignore-style glob into a RegExp source anchored to the full
// relative path. Supports: `**` (any depth incl. zero dirs), `*` (one segment,
// no `/`), `?` (one non-`/` char), leading `/` anchor, trailing `/` dir marker,
// and a bare name (`legacy`) that matches at any depth. Returns null for an
// empty/uncompilable pattern (skipped by the caller).
function globToRegExpSource(pattern) {
  let pat = pattern;
  if (!pat) return null;

  // a trailing slash marks a directory; we strip it and remember (a dir pattern
  // matches the dir and everything under it).
  const isDirOnly = pat.endsWith('/');
  if (isDirOnly) pat = pat.slice(0, -1);
  if (!pat) return null;

  // anchoring: a leading slash anchors to the app root. A pattern WITHOUT a slash
  // anywhere (other than a possible leading one) matches at ANY depth (gitignore
  // semantics: `legacy` ignores legacy/ everywhere). A pattern with an interior
  // slash is anchored to the root.
  const anchoredToRoot = pat.startsWith('/');
  if (anchoredToRoot) pat = pat.slice(1);
  if (!pat) return null;

  const hasInteriorSlash = pat.indexOf('/') !== -1;
  const matchAnyDepth = !anchoredToRoot && !hasInteriorSlash;

  // build the regex body segment by segment, escaping regex metachars and
  // translating glob tokens.
  let body = '';
  for (let i = 0; i < pat.length; i += 1) {
    const c = pat[i];
    if (c === '*') {
      // `**` → any depth (including across `/`); `*` → any run within a segment.
      if (pat[i + 1] === '*') {
        // consume the second star
        i += 1;
        // `**/` collapses to "zero or more path segments"
        if (pat[i + 1] === '/') {
          i += 1;
          body += '(?:.*/)?';
        } else {
          body += '.*';
        }
      } else {
        body += '[^/]*';
      }
    } else if (c === '?') {
      body += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      body += '\\' + c;
    } else if (c === '/') {
      body += '/';
    } else {
      body += c;
    }
  }

  // A directory-or-prefix pattern (dir-only marker, or a bare name, or a name
  // ending without a wildcard) should also match everything UNDER it. We let the
  // matcher append a `(?:/.*)?` tail so `legacy` matches `legacy/foo.tsx` and
  // `functions/**` (already ends in `.*`) still works.
  const prefix = matchAnyDepth ? '(?:^|.*/)' : '^';
  // tail: match the path itself OR anything nested under it (dir semantics). This
  // is safe for file patterns too (a file has no children, so the `/…` branch
  // never matches a real file path).
  const tail = '(?:/.*)?$';

  return prefix + body + tail;
}

function compileRule(rawLine) {
  let line = rawLine;
  // strip a trailing CR (CRLF files) and surrounding whitespace.
  line = line.replace(/\r$/, '');
  // a leading `#` is a comment; blank lines are no-ops.
  const trimmed = line.replace(/^\s+/, '');
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  // gitignore: trailing spaces are ignored unless escaped; we do the common case.
  let pat = trimmed.replace(/\s+$/, '');
  let negate = false;
  if (pat.startsWith('!')) {
    negate = true;
    pat = pat.slice(1);
  }
  if (!pat) return null;
  const src = globToRegExpSource(pat);
  if (!src) return null;
  let re;
  try {
    re = new RegExp(src);
  } catch {
    return null; // uncompilable pattern → skip it, never throw.
  }
  return { negate, test: (relPosix) => re.test(relPosix) };
}

// Parse a gitignore-syntax text blob into an ordered rule list. Order matters:
// gitignore applies the LAST matching rule (so a later `!negation` can re-include).
function parseGitignoreText(text) {
  if (text == null) return [];
  const rules = [];
  for (const line of String(text).split('\n')) {
    const rule = compileRule(line);
    if (rule) rules.push(rule);
  }
  return rules;
}

// ---------------------------------------------------------------------------
// eslint flat-config globalIgnores extraction. We do NOT execute the config (it
// may import plugins we don't have). Instead we statically pull the first
// `globalIgnores([ ... ])` array's string literals via a tolerant text scan —
// the only shape that occurs in the estate. Each literal is a flat-config glob
// (`legacy/**`, `functions/**`, `.next/**`, a specific file path) and is parsed
// with the SAME glob compiler as gitignore (the syntaxes overlap for our cases).
// ---------------------------------------------------------------------------

function extractGlobalIgnoreGlobs(text) {
  if (text == null) return [];
  const globs = [];
  // find every globalIgnores( ... ) call and read string literals out of its
  // argument list up to the matching close paren. Tolerant: handles the array
  // form globalIgnores([ "a/**", "b/**" ]) and a comments-interleaved body.
  const callRe = /globalIgnores\s*\(/g;
  let m;
  while ((m = callRe.exec(text)) !== null) {
    const start = m.index + m[0].length;
    // walk forward to the matching paren, tracking depth, collecting string
    // literals. Strip line + block comments so a commented-out glob isn't read.
    let depth = 1;
    let i = start;
    let segment = '';
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      if (depth > 0) segment += ch;
      i += 1;
    }
    // strip block + line comments from the captured segment.
    const cleaned = segment
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    // pull single/double/backtick quoted literals (no interpolation expected).
    const strRe = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
    let sm;
    while ((sm = strRe.exec(cleaned)) !== null) {
      const val = sm[2];
      if (val && val.trim()) globs.push(val.trim());
    }
  }
  return globs;
}

// ---------------------------------------------------------------------------
// buildIgnoreMatcher(appRoot, options) — assemble the matcher from all signals.
//
// Returns { isIgnored(relPath), sources, patternCount }:
//   isIgnored(relPath) — true iff the app-root-relative path (POSIX or native
//     separators accepted) should be EXCLUDED from the scan inventory.
//   sources — which signals contributed ({ gitignore, eslintignore, eslintConfig,
//     defaults }) for the brief/diagnostics.
//   patternCount — total compiled rules (defaults + file-derived).
//
// options.extraExcludeDirs — additional bare dir names to always exclude (the
//   scanner passes its own SKIP_DIRS so the two stay in sync without duplication).
//
// NEVER THROWS. Each signal is read defensively; a missing or unparseable file
// contributes nothing and the built-in defaults still apply.
// ---------------------------------------------------------------------------

export function buildIgnoreMatcher(appRoot, options = {}) {
  const sources = {
    defaults: true,
    gitignore: false,
    eslintignore: false,
    eslintConfig: false,
  };

  // 1. built-in default dir excludes (always). Compiled as bare-name dir rules so
  //    they match at any depth (node_modules nested in a workspace, etc.).
  const defaultDirs = [...new Set([...DEFAULT_EXCLUDE_DIRS, ...(options.extraExcludeDirs || [])])];
  const rules = [];
  for (const dir of defaultDirs) {
    const rule = compileRule(`${dir}/`);
    if (rule) rules.push(rule);
  }

  // 2. .gitignore
  const gitignoreText = readText(join(appRoot, '.gitignore'));
  if (gitignoreText != null) {
    const r = parseGitignoreText(gitignoreText);
    if (r.length) {
      rules.push(...r);
      sources.gitignore = true;
    }
  }

  // 3. .eslintignore (legacy)
  const eslintIgnoreText = readText(join(appRoot, '.eslintignore'));
  if (eslintIgnoreText != null) {
    const r = parseGitignoreText(eslintIgnoreText);
    if (r.length) {
      rules.push(...r);
      sources.eslintignore = true;
    }
  }

  // 4. eslint.config.* globalIgnores([...])
  for (const cfgName of ESLINT_CONFIG_FILES) {
    const cfgPath = join(appRoot, cfgName);
    if (!existsSync(cfgPath)) continue;
    const cfgText = readText(cfgPath);
    if (cfgText == null) continue;
    const globs = extractGlobalIgnoreGlobs(cfgText);
    let added = 0;
    for (const g of globs) {
      const rule = compileRule(g);
      if (rule) {
        rules.push(rule);
        added += 1;
      }
    }
    if (added) sources.eslintConfig = true;
    // first present eslint config wins (matches eslint's own single-config model).
    break;
  }

  function isIgnored(relPath) {
    const rel = toPosix(relPath).replace(/^\.?\/+/, '').replace(/^\.$/, '');
    if (!rel) return false;
    // apply rules in order; the LAST matching rule decides (gitignore semantics:
    // a later `!negation` re-includes a path an earlier rule excluded).
    let ignored = false;
    for (const rule of rules) {
      if (rule.test(rel)) {
        ignored = !rule.negate;
      }
    }
    return ignored;
  }

  return { isIgnored, sources, patternCount: rules.length };
}

export default buildIgnoreMatcher;
