// vibe-lingual engine — detection (M1).
//
// Pure read. Walks a target app root and classifies:
//   - i18n framework        (next-intl / react-i18next / react-intl / lingui / i18next / none)
//   - router type           (app / pages / unknown)
//   - Turbopack presence    (explicit --turbo/--turbopack flag OR a `turbopack` config key)
//   - SSR files             (App Router page.tsx / layout.tsx — the locale-loader surfaces)
//   - existing-i18n map     (a SUPPORTED_LANGUAGES-shaped language list + an outputLanguage-shaped pref)
//
// Returns a structured object matching the inventory.json "app" + "existingI18n" shapes in spec.md.
// No mutation, no network. Missing files degrade to nulls/empties, never throw.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ---------------------------------------------------------------------------
// framework detection — package.json dependency presence, in priority order.
// next-intl wins first because it is the v1 adapter; the rest are detected so
// audit/localize can report "not-yet-implemented" honestly rather than crash.
// ---------------------------------------------------------------------------

// Ordered: the first dependency present wins. A project carrying both next-intl
// and i18next (rare) classifies as next-intl — the App-Router-native choice.
const FRAMEWORK_DEPS = [
  ['next-intl', 'next-intl'],
  ['react-i18next', 'react-i18next'],
  ['react-intl', 'react-intl'],
  ['lingui', '@lingui/core'],
  ['lingui', '@lingui/react'],
  ['i18next', 'i18next'],
];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function allDeps(pkg) {
  if (!pkg || typeof pkg !== 'object') return {};
  return {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {}),
    ...(pkg.optionalDependencies || {}),
  };
}

function detectFramework(deps) {
  for (const [framework, depName] of FRAMEWORK_DEPS) {
    if (Object.prototype.hasOwnProperty.call(deps, depName)) {
      return framework;
    }
  }
  return 'none';
}

// ---------------------------------------------------------------------------
// router type — App Router if an `app/` dir with a layout/page exists (under
// src/ or root); Pages Router if a `pages/` dir exists; else unknown.
// App Router takes precedence when both are present (Next allows the mix; the
// App tree is the i18n-relevant one for our adapter).
// ---------------------------------------------------------------------------

function dirHasRouteFiles(dir) {
  if (!existsSync(dir)) return false;
  try {
    if (!statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return true;
}

function detectRouterType(root) {
  const appCandidates = [join(root, 'app'), join(root, 'src', 'app')];
  const pagesCandidates = [join(root, 'pages'), join(root, 'src', 'pages')];

  const appDir = appCandidates.find(dirHasRouteFiles) || null;
  const pagesDir = pagesCandidates.find(dirHasRouteFiles) || null;

  if (appDir) return { routerType: 'app', appDir, pagesDir };
  if (pagesDir) return { routerType: 'pages', appDir: null, pagesDir };
  return { routerType: 'unknown', appDir: null, pagesDir: null };
}

// ---------------------------------------------------------------------------
// Turbopack — explicit signal only. Either a `--turbo`/`--turbopack` flag in a
// next-script in package.json, or a `turbopack` key in next.config.*. We do NOT
// infer Turbopack from Next's version default; report what's literally present.
// ---------------------------------------------------------------------------

const TURBO_FLAG_RE = /\bnext\b[^\n]*--turbo(pack)?\b/;

function detectTurbopack(root, pkg) {
  const scripts = (pkg && pkg.scripts) || {};
  for (const cmd of Object.values(scripts)) {
    if (typeof cmd === 'string' && TURBO_FLAG_RE.test(cmd)) return true;
  }
  for (const name of ['next.config.ts', 'next.config.js', 'next.config.mjs', 'next.config.cjs']) {
    const text = readText(join(root, name));
    if (text && /\bturbopack\s*:/.test(text)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// SSR files — App Router page.tsx / layout.tsx (the surfaces a locale loader
// would mount on, and where firebase-admin must be screened out). Recursive
// walk of the app dir, skipping node_modules and dotdirs. Paths relative to root,
// POSIX-normalized for stable cross-platform output.
// ---------------------------------------------------------------------------

const SSR_FILE_RE = /^(page|layout)\.(tsx|jsx|ts|js)$/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

function toPosix(p) {
  return p.split(sep).join('/');
}

function walkSsrFiles(dir, root, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkSsrFiles(full, root, acc);
    } else if (entry.isFile() && SSR_FILE_RE.test(entry.name)) {
      acc.push(toPosix(relative(root, full)));
    }
  }
}

function detectSsrFiles(root, appDir) {
  if (!appDir) return [];
  const acc = [];
  walkSsrFiles(appDir, root, acc);
  return acc.sort();
}

// ---------------------------------------------------------------------------
// existing-i18n map — find a SUPPORTED_LANGUAGES-shaped language list and an
// outputLanguage-shaped locale pref. Lexical scan over src/ + lib/ + common
// roots. We match a *declaration* of the symbol (export/const/let/field), not a
// bare reference, so picking up a usage site doesn't masquerade as the source.
// `lib` is the detected i18n dependency name (e.g. 'next-intl') or null.
// ---------------------------------------------------------------------------

const SCAN_EXT_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const I18N_SCAN_ROOTS = ['src', 'lib', 'app', 'config', '.'];

// Declaration of an ALL-CAPS language-list symbol, value is an array literal.
// e.g. `export const SUPPORTED_LANGUAGES = [` / `const LANGUAGES: ... = [`
const LANGUAGE_LIST_RE =
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]*(?:LANGUAGES|LOCALES|LANGS))\b[^=\n]*=\s*\[/m;

// Declaration of an output-language-shaped locale pref — a real declaration
// site, never a usage. Three accepted forms, all genuine declarations:
//   (1) `const|let|var outputLanguage =` — keyword MANDATORY (mirrors
//       LANGUAGE_LIST_RE), so a JSX attribute `uiLanguage={…}` or an object
//       property `{ uiLanguage: code }` no longer masquerades as a declaration.
//   (2) `uiLanguage?: string` — an optional TS type/interface field. The `?:`
//       form is unique to type fields; expressions never carry it.
//   (3) `outputLanguage: string` — a required TS type/interface field, where the
//       RHS is a *type* (a bareword identifier / union), NOT a value expression.
//       This is what separates a type field from an object-literal property whose
//       value is a string/number/JSX expression (`uiLanguage: "en"`, `={…}`).
// Capture group lands in m[1]|m[2]|m[3] depending on which form matched.
const LOCALE_PREF_RE =
  /\b(?:export\s+)?(?:(?:const|let|var)\s+(outputLanguage|uiLanguage|localePreference|preferredLocale)\b\s*[:=]|(outputLanguage|uiLanguage|localePreference|preferredLocale)\s*\?\s*:\s*[A-Za-z_$][\w$.<>[\] |]*|(outputLanguage|uiLanguage|localePreference|preferredLocale)\s*:\s*[A-Za-z_$][\w$.<>[\] |]*\s*[;\n])/m;

function listAppFiles(root) {
  const files = [];
  const seen = new Set();
  for (const r of I18N_SCAN_ROOTS) {
    const start = r === '.' ? root : join(root, r);
    if (!existsSync(start)) continue;
    walkSourceFiles(start, files, seen, root);
  }
  return files;
}

function walkSourceFiles(dir, acc, seen, root) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      walkSourceFiles(full, acc, seen, root);
    } else if (entry.isFile() && SCAN_EXT_RE.test(entry.name)) {
      if (seen.has(full)) continue;
      seen.add(full);
      acc.push(full);
    }
  }
}

function detectExistingI18n(root, framework) {
  const lib = framework === 'none' ? null : framework;
  let languageList = null;
  let localePref = null;

  for (const file of listAppFiles(root)) {
    const text = readText(file);
    if (!text) continue;

    if (!languageList) {
      const m = text.match(LANGUAGE_LIST_RE);
      if (m) {
        languageList = { file: toPosix(relative(root, file)), symbol: m[1] };
      }
    }
    if (!localePref) {
      const m = text.match(LOCALE_PREF_RE);
      if (m) {
        // Three declaration forms → symbol is in whichever alternation matched.
        const symbol = m[1] || m[2] || m[3];
        localePref = { file: toPosix(relative(root, file)), symbol };
      }
    }
    if (languageList && localePref) break;
  }

  return { lib, languageList, localePref };
}

// ---------------------------------------------------------------------------
// top-level detect — assemble the inventory "app" + "existingI18n" object.
// ---------------------------------------------------------------------------

export function detect(root) {
  const pkg = readJson(join(root, 'package.json'));
  const deps = allDeps(pkg);

  const framework = detectFramework(deps);
  const { routerType, appDir } = detectRouterType(root);
  const turbopack = detectTurbopack(root, pkg);
  const ssrFiles = detectSsrFiles(root, appDir);
  const existingI18n = detectExistingI18n(root, framework);

  return {
    app: {
      root,
      framework,
      routerType,
      turbopack,
      ssrFiles,
    },
    existingI18n,
  };
}

export default detect;
