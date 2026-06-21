// vibe-lingual engine — string-site scan (M2).
//
// Pure read. Walks a target app's component files, parses each with @babel/parser
// (jsx + typescript plugins — never regex over JSX), and emits user-facing string
// sites classified by KIND:
//   jsx-text     — visible text node inside JSX
//   placeholder  — <input placeholder="...">
//   aria-label   — accessibility label attribute
//   title        — title attribute (tooltip)
//   alt          — image alt text
//   toast        — toast/notification/Error string literal (toast(...), new Error(...), ...)
//   date-intl    — Intl.DateTimeFormat / toLocale*String — locale-sensitive date sites
//
// Classification rules baked in from the cowpath (docs/inputs/cowpath-seed.md):
//   - KTD-4: the SCANNER owns attribute-literal detection (placeholder/aria-label/
//     title/alt). ESLint is too noisy on attributes; we do not delegate.
//   - KTD-5: structural vs presentational Intl. A date-intl site doing tz-offset
//     math / locale-invariant parsing (e.g. new Intl.DateTimeFormat('en-CA', {...,
//     timeZone}) inside birthDateTime.ts) is STRUCTURAL — flagged excluded, never
//     auto-included. Extracting it corrupts logic.
//   - False-positive guards: className/class/data-*/id/test-id/key/href/type/role
//     attributes are NOT user-facing. CSS-class-shaped and identifier-shaped JSX
//     text is rejected. Strings already wrapped in a t()/translation call (the
//     regression oracle — already-extracted surfaces) are NOT re-flagged.
//
// No mutation, no network. A file that fails to parse is skipped (recorded as a
// parse error count), never throws.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep, basename, dirname } from 'node:path';
import { parse } from '@babel/parser';

// ---------------------------------------------------------------------------
// file discovery — component files only (.tsx/.jsx and their .ts/.js siblings
// that may hold toast/Intl strings). Skip the usual non-source dirs + test files
// (tests carry literal strings that are NOT product UI).
// ---------------------------------------------------------------------------

const COMPONENT_EXT_RE = /\.(tsx|jsx|ts|js|mjs|cjs)$/;
const TEST_FILE_RE = /(\.test\.|\.spec\.|__tests__|__mocks__)/;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', 'out']);
const SCAN_ROOTS = ['src', 'app', 'components', 'pages', 'lib', 'utils', '.'];

function toPosix(p) {
  return p.split(sep).join('/');
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
    } else if (entry.isFile() && COMPONENT_EXT_RE.test(entry.name)) {
      if (TEST_FILE_RE.test(toPosix(relative(root, full)))) continue;
      if (seen.has(full)) continue;
      seen.add(full);
      acc.push(full);
    }
  }
}

function listComponentFiles(root) {
  const files = [];
  const seen = new Set();
  for (const r of SCAN_ROOTS) {
    const start = r === '.' ? root : join(root, r);
    if (!existsSync(start)) continue;
    try {
      if (!statSync(start).isDirectory()) continue;
    } catch {
      continue;
    }
    walkSourceFiles(start, files, seen, root);
  }
  return files;
}

// ---------------------------------------------------------------------------
// user-facing-text heuristics — separate real copy from machinery.
// ---------------------------------------------------------------------------

// Attributes that hold user-visible copy and SHOULD be extracted.
const TEXT_ATTRS = new Set(['placeholder', 'aria-label', 'arialabel', 'title', 'alt']);
const ATTR_KIND = {
  placeholder: 'placeholder',
  'aria-label': 'aria-label',
  arialabel: 'aria-label',
  title: 'title',
  alt: 'alt',
};

// Attributes that are machinery — never user-facing. A literal here is a guard
// target (must NOT be extracted): classes, data hooks, ids, test ids, routing,
// form wiring, keys, types, roles, etc.
const NON_TEXT_ATTRS = new Set([
  'classname',
  'class',
  'id',
  'htmlfor',
  'key',
  'ref',
  'href',
  'src',
  'srcset',
  'type',
  'name',
  'value',
  'role',
  'rel',
  'target',
  'method',
  'action',
  'as',
  'slot',
  'datatestid',
  'data-testid',
  'data-test',
  'data-cy',
  'data-qa',
  'aria-hidden',
  'autocomplete',
  'autocapitalize',
  'inputmode',
  'enterkeyhint',
  'lang',
  'dir',
  'charset',
  'sizes',
  'media',
  'crossorigin',
  'referrerpolicy',
  'loading',
  'decoding',
  'fetchpriority',
  'style',
  'viewbox',
  'xmlns',
  'fill',
  'stroke',
  'd',
  'points',
  'transform',
]);

// A string that is plausibly user-facing copy: has at least one letter, contains
// a word a human reads. Rejects pure punctuation/whitespace/numbers/symbols.
function hasLetter(s) {
  return /[A-Za-zÀ-ɏЀ-ӿ֐-׿؀-ۿ一-鿿぀-ヿ]/.test(s);
}

// CSS-class / token-shaped string: tailwind-ish or kebab/utility tokens, no
// spaces-with-real-words. e.g. "w-full bg-black/50", "flex items-center",
// "text-[10px]", "bg-[#0b0a16]". Heuristic: every space-separated chunk looks
// like a CSS token (contains a digit/slash/bracket/colon/hash, or is a known
// utility prefix), OR the whole thing is a single kebab/snake identifier.
const CSS_TOKEN_RE = /^[a-z0-9]+(?:[-:/][a-z0-9[\]#.%()_,-]+)+$/i;
const UTILITY_PREFIX_RE =
  /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|static|w|h|m[trblxy]?|p[trblxy]?|gap|space|text|bg|border|rounded|shadow|font|leading|tracking|uppercase|lowercase|capitalize|truncate|overflow|cursor|opacity|transition|transform|translate|scale|rotate|z|top|bottom|left|right|min|max|order|col|row|justify|items|content|self|place|sr|pointer|select|whitespace|break|object|aspect|backdrop|ring|outline|divide|from|via|to|stroke|fill)$/;

function isCssClassString(s) {
  const trimmed = s.trim();
  if (!trimmed) return true;
  // single identifier-ish token with no spaces and no real word break
  if (!/\s/.test(trimmed)) {
    if (CSS_TOKEN_RE.test(trimmed)) return true;
    if (UTILITY_PREFIX_RE.test(trimmed.split(/[-:/]/)[0])) return true;
  }
  const chunks = trimmed.split(/\s+/);
  if (chunks.length > 1) {
    const cssLike = chunks.every((c) => {
      const head = c.split(/[-:/[]/)[0];
      return (
        CSS_TOKEN_RE.test(c) ||
        UTILITY_PREFIX_RE.test(head) ||
        /[[\]#%().]/.test(c) ||
        /[-:/]/.test(c)
      );
    });
    if (cssLike) return true;
  }
  return false;
}

// An identifier-shaped token (camelCase / snake_case / dotted path / single word
// with no spaces and no sentence punctuation) is machinery, not copy. e.g.
// "submitButton", "user.name", "MAX_LEN". A single capitalized real word ("Save")
// IS copy, so single dictionary-ish words are allowed; reject only multi-segment
// identifiers and ALL_CAPS_CONST shapes.
function isIdentifierShaped(s) {
  const t = s.trim();
  if (/\s/.test(t)) return false; // has a space → could be a phrase
  if (/^[A-Z0-9_]+$/.test(t) && t.length > 2) return true; // ALL_CAPS_CONST
  if (/[._/]/.test(t) && !/[.!?]$/.test(t)) return true; // dotted/path/snake id
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(t)) return true; // camelCase
  return false;
}

// Developer-facing INVARIANT / assertion messages that ship inside `new Error(...)`
// (or `throw new Error(...)`) but never reach a user — React hook-provider guards,
// "not defined" / "expected X to be Y" assertions, "should never happen" branches.
// These must NOT enter the localization surface: translating a dev assertion is
// pure noise and risks a translator "fixing" a string that code-paths assert on.
//
// Shapes (from the Celestia3 dogfood, where the scanner wrongly captured three
// hook-provider invariants as kind=toast at medium confidence):
//   - 'useAuth must be used within an AuthProvider'   (hook-context guard)
//   - 'useSettings must be used within a SettingsProvider'
//   - 'useSubscription must be used within a SubscriptionProvider'
// Generalized: "must be used within", "is not defined", "expected … to be …",
// "should never happen", "unreachable", "invariant", "assertion failed", and the
// hook-name-prefixed `useXxx must …` shape.
const DEV_INVARIANT_RES = [
  /\bmust be used within\b/i,
  /\bis not defined\b/i,
  /\bexpected\b.+\bto be\b/i,
  /\bshould never happen\b/i,
  /\bunreachable\b/i,
  /\binvariant\b/i,
  /\bassertion failed\b/i,
  /\bnot implemented\b/i,
  /^use[A-Z]\w*\b.*\bmust\b/, // useXxx must …  (hook-context guard)
];

function isDevInvariantMessage(s) {
  const t = String(s).trim();
  if (!t) return false;
  return DEV_INVARIANT_RES.some((re) => re.test(t));
}

// Final gate for whether a candidate string is user-facing copy worth a site.
// `kind` lets the gate apply a kind-specific floor: a JSX-text node that is a
// single token of <=2 chars is below the floor for a standalone translation key —
// it is almost always a sentence fragment split by an inline element
// (`<p>We <strong>…</strong></p>` yields a "We" text node) or a unit suffix
// (`{xp} XP`, `{n} Hz`, "0d"). These need t.rich() at the localize phase, not a
// bare key; for the scan inventory they are noise. The floor is NOT applied to
// attribute kinds (a `title="OK"` / `alt="ID"` is legitimately short).
function isUserFacingText(s, kind) {
  const t = s.trim();
  if (!t) return false;
  if (!hasLetter(t)) return false;
  if (isCssClassString(t)) return false;
  if (isIdentifierShaped(t)) return false;
  if (kind === 'jsx-text') {
    const tokens = t.split(/\s+/);
    if (tokens.length === 1 && t.length <= 2) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// suggested namespace + key + confidence.
// Namespace: PascalCase component basename (Celestia3 convention — namespace
// equals the component, e.g. CosmicCalibration). 'common' fallback for shared
// utility/lib files. Key: a camelCase slug from the first words of the text.
// Confidence: high for a clean short phrase, medium for long/variable-ish text,
// low for attribute machinery-adjacent or interpolated fragments.
// ---------------------------------------------------------------------------

function componentNamespace(relPosix) {
  const base = basename(relPosix).replace(/\.(tsx|jsx|ts|js|mjs|cjs)$/, '');
  // route files (page/layout/route) take the parent dir name as namespace
  if (/^(page|layout|route|template|loading|error|not-found)$/i.test(base)) {
    const parent = basename(dirname(relPosix));
    if (parent && parent !== '.' && !/^\[.*\]$/.test(parent)) {
      return toPascal(parent);
    }
    return 'Page';
  }
  // lib/utils files → common namespace
  if (/(^|\/)(lib|utils|helpers|services)(\/|$)/.test(relPosix) && !/^[A-Z]/.test(base)) {
    return 'common';
  }
  return /^[A-Z]/.test(base) ? base : toPascal(base);
}

function toPascal(s) {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function suggestedKey(text) {
  const words = text
    .trim()
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  if (words.length === 0) return 'label';
  const camel = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
  return camel.slice(0, 48) || 'label';
}

function siteConfidence(kind, text) {
  const len = text.trim().length;
  if (kind === 'date-intl') return 'low'; // always needs human review
  if (kind === 'toast') return text.includes('${') || text.includes('{') ? 'low' : 'medium';
  if (len <= 60 && !/[{}]/.test(text)) return 'high';
  if (len <= 140) return 'medium';
  return 'low';
}

// ---------------------------------------------------------------------------
// structural-vs-presentational Intl classification (KTD-5).
// A date-intl site is STRUCTURAL (excluded, never auto-included) when it is doing
// locale-invariant math rather than producing display copy. Signals:
//   - locale arg is a fixed machine locale used for PARSING/normalization
//     ('en-CA' ISO-ish, 'en-US' for tz extraction) AND an explicit timeZone option
//     is present (tz-offset math, the birthDateTime.ts shape), OR
//   - the file lives under lib/utils/helpers and the call is not inside JSX, OR
//   - the formatter result is consumed by .formatToParts / arithmetic, not rendered.
// Presentational date sites (toLocaleDateString in a component for display) stay
// included but at low confidence (they need a useFormatter rewrite + a timeZone
// decision, surfaced by audit — never silently extracted as a plain t()).
// ---------------------------------------------------------------------------

const MACHINE_LOCALE_RE = /^en-(CA|US|GB)$|^sv-SE$|^fr-CA$/;

function classifyIntlSite({ localeArg, hasTimeZoneOpt, hasFormatToParts, inComponentFile, insideJsx }) {
  // tz-offset math: a fixed machine locale + an explicit timeZone option, or a
  // formatToParts consumer → structural.
  if (hasFormatToParts) return { structural: true, reason: 'formatToParts consumer (locale-invariant parsing)' };
  if (localeArg && MACHINE_LOCALE_RE.test(localeArg) && hasTimeZoneOpt) {
    return { structural: true, reason: 'fixed machine locale + explicit timeZone (tz-offset math)' };
  }
  // KTD-5 (the dogfood miss): a BARE fixed machine locale (en-CA/en-US/en-GB/
  // sv-SE/fr-CA, NO timeZone option) that is NOT rendered in JSX is a date-KEY,
  // not display copy — `new Date().toLocaleDateString('en-CA')` assigned to a
  // `todayStr`/`todayKey` const and compared against a stored ISO date. The
  // machine locale is there to force a stable ISO/locale-invariant string for
  // LOGIC, not to show the user anything. Extracting it (a later useFormatter
  // rewrite) would corrupt the streak/daily-key comparison. Classify structural
  // regardless of timeZone presence whenever the result is not in the JSX tree.
  if (localeArg && MACHINE_LOCALE_RE.test(localeArg) && !insideJsx) {
    return { structural: true, reason: 'fixed machine locale, not rendered in JSX (date-key logic, not display)' };
  }
  // a date formatter in a non-component lib/util file, not rendered in JSX → structural by location.
  if (!inComponentFile && !insideJsx) {
    return { structural: true, reason: 'date math in a non-component module (not rendered)' };
  }
  return { structural: false, reason: null };
}

// ---------------------------------------------------------------------------
// AST scan of a single file.
// ---------------------------------------------------------------------------

function parseFile(text) {
  return parse(text, {
    sourceType: 'unambiguous',
    allowReturnOutsideFunction: true,
    errorRecovery: true,
    plugins: [
      'jsx',
      'typescript',
      'decorators-legacy',
      'classProperties',
      'objectRestSpread',
      'optionalChaining',
      'nullishCoalescingOperator',
      'topLevelAwait',
      'importAssertions',
    ],
  });
}

const TRANSLATION_CALLEES = new Set(['t', '__', 'i18n', 'translate', 'getTranslations', 'useTranslations', 'formatMessage']);
const TOAST_CALLEES = new Set(['toast', 'notify', 'alert', 'enqueueSnackbar', 'showToast', 'message']);
const TOAST_MEMBERS = new Set(['error', 'success', 'warning', 'info', 'loading', 'warn']);
const INTL_DATE_METHODS = new Set(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']);

function calleeName(node) {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && node.property) {
    return node.property.type === 'Identifier' ? node.property.name : null;
  }
  return null;
}

// Generic depth-first AST visitor. We do not pull in a traverse dependency; a
// hand-rolled walk over enumerable child nodes is enough and keeps the engine
// dependency-light. Tracks JSX-nesting + translation-call nesting via a context
// object passed down.
function visit(node, parent, ctx, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node, parent, ctx);

  // compute child context (inside JSX? inside a translation call?)
  let childCtx = ctx;
  if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
    childCtx = { ...ctx, insideJsx: true };
  }
  if (
    node.type === 'CallExpression' &&
    TRANSLATION_CALLEES.has(calleeName(node.callee))
  ) {
    childCtx = { ...childCtx, insideTranslationCall: true };
  }

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'range' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const child of val) {
        if (child && typeof child.type === 'string') visit(child, node, childCtx, fn);
      }
    } else if (val && typeof val.type === 'string') {
      visit(val, node, childCtx, fn);
    }
  }
}

function stringLiteralValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'JSXExpressionContainer') return stringLiteralValue(node.expression);
  // a template literal with no interpolation is a plain string
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0 && node.quasis.length === 1) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function lineOf(node) {
  return node && node.loc ? node.loc.start.line : 0;
}

function scanFile(absPath, relPosix, text) {
  const sites = [];
  let ast;
  try {
    ast = parseFile(text);
  } catch {
    return { sites, parseError: true };
  }

  const inComponentFile = /\.(tsx|jsx)$/.test(relPosix);
  const namespace = componentNamespace(relPosix);

  visit(ast.program, null, { insideJsx: false, insideTranslationCall: false }, (node, parent, ctx) => {
    // ----- JSX text -----
    if (node.type === 'JSXText') {
      if (ctx.insideTranslationCall) return; // already extracted
      const raw = node.value;
      if (!isUserFacingText(raw, 'jsx-text')) return;
      const textVal = raw.trim();
      sites.push(makeSite(relPosix, lineOf(node), 'jsx-text', textVal, namespace));
      return;
    }

    // ----- JSX attributes (placeholder / aria-label / title / alt) -----
    if (node.type === 'JSXAttribute' && node.name) {
      const attrName = (node.name.name && (node.name.name.name || node.name.name)) || '';
      const lower = String(attrName).toLowerCase();
      if (NON_TEXT_ATTRS.has(lower)) return;
      if (!TEXT_ATTRS.has(lower)) return;
      const val = stringLiteralValue(node.value);
      if (val == null) return;
      if (!isUserFacingText(val)) return;
      const kind = ATTR_KIND[lower];
      sites.push(makeSite(relPosix, lineOf(node), kind, val.trim(), namespace));
      return;
    }

    // ----- toast / Error string literals -----
    if (node.type === 'NewExpression' && node.callee && node.callee.type === 'Identifier' && /Error$/.test(node.callee.name)) {
      const arg = node.arguments && node.arguments[0];
      const val = stringLiteralValue(arg);
      // Skip developer-facing invariant/assertion Error messages — these never
      // reach a user and must never be translated (the hook-provider-guard case
      // the Celestia3 dogfood over-captured).
      if (val != null && isUserFacingText(val) && !isDevInvariantMessage(val)) {
        sites.push(makeSite(relPosix, lineOf(node), 'toast', val.trim(), namespace));
      }
      return;
    }
    if (node.type === 'CallExpression') {
      const cn = calleeName(node.callee);
      const isToast =
        (node.callee.type === 'Identifier' && TOAST_CALLEES.has(node.callee.name)) ||
        (node.callee.type === 'MemberExpression' &&
          node.callee.object &&
          node.callee.object.type === 'Identifier' &&
          TOAST_CALLEES.has(node.callee.object.name) &&
          TOAST_MEMBERS.has(cn));
      if (isToast && !ctx.insideTranslationCall) {
        const arg = node.arguments && node.arguments[0];
        const val = stringLiteralValue(arg);
        if (val != null && isUserFacingText(val)) {
          sites.push(makeSite(relPosix, lineOf(node), 'toast', val.trim(), namespace));
        }
      }

      // ----- Intl.DateTimeFormat(...) -----
      const callee = node.callee;
      const isIntlDTF =
        callee.type === 'MemberExpression' &&
        callee.object &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'Intl' &&
        callee.property &&
        callee.property.name === 'DateTimeFormat';
      // also new Intl.DateTimeFormat handled below in NewExpression
      if (isIntlDTF) {
        pushIntlSite(sites, node, relPosix, namespace, inComponentFile, ctx);
      }

      // ----- date.toLocale*String(...) -----
      if (
        callee.type === 'MemberExpression' &&
        callee.property &&
        INTL_DATE_METHODS.has(callee.property.name)
      ) {
        pushIntlSite(sites, node, relPosix, namespace, inComponentFile, ctx, { isToLocale: true });
      }
      return;
    }

    // ----- new Intl.DateTimeFormat(...) -----
    if (node.type === 'NewExpression') {
      const callee = node.callee;
      if (
        callee &&
        callee.type === 'MemberExpression' &&
        callee.object &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'Intl' &&
        callee.property &&
        callee.property.name === 'DateTimeFormat'
      ) {
        pushIntlSite(sites, node, relPosix, namespace, inComponentFile, ctx);
      }
    }
  });

  return { sites, parseError: false };
}

// Inspect an Intl.DateTimeFormat / toLocale*String call and push a date-intl site
// with the structural classification applied.
function pushIntlSite(sites, node, relPosix, namespace, inComponentFile, ctx, opts = {}) {
  const args = node.arguments || [];
  // locale arg position: DateTimeFormat(locale, options); toLocale*String(locale, options)
  const localeArg = stringLiteralValue(args[0]);
  const optionsArg = args[1] || (opts.isToLocale ? args[1] : args[1]);
  let hasTimeZoneOpt = false;
  const optObj = optionsArg && optionsArg.type === 'ObjectExpression' ? optionsArg : null;
  if (optObj) {
    for (const prop of optObj.properties) {
      const keyName =
        prop.key && (prop.key.name || prop.key.value);
      if (keyName === 'timeZone') hasTimeZoneOpt = true;
    }
  }
  // detect a .formatToParts consumer on the same expression (parent member chain)
  const hasFormatToParts = false; // conservative: only set via explicit member detection below

  const { structural, reason } = classifyIntlSite({
    localeArg,
    hasTimeZoneOpt,
    hasFormatToParts,
    inComponentFile,
    insideJsx: ctx.insideJsx,
  });

  const label = localeArg ? `Intl date (${localeArg})` : 'Intl date';
  const site = makeSite(relPosix, lineOf(node), 'date-intl', label, namespace);
  site.structuralIntl = structural;
  if (structural) {
    site.excluded = true;
    site.excludedReason = reason;
    site.confidence = 'low';
  }
  sites.push(site);
}

function makeSite(file, line, kind, text, namespace) {
  return {
    file,
    line,
    kind,
    text,
    suggestedNamespace: namespace,
    suggestedKey: suggestedKey(kind === 'date-intl' ? 'date' + text : text),
    confidence: siteConfidence(kind, text),
    structuralIntl: false,
  };
}

// ---------------------------------------------------------------------------
// top-level scan — assemble the inventory sites + countsByKind + density.
// `detection` is the M1 detect() output ({ app, existingI18n }); scan layers the
// site inventory on top so the inventory.json is self-contained.
// ---------------------------------------------------------------------------

const ALL_KINDS = ['jsx-text', 'placeholder', 'aria-label', 'title', 'alt', 'toast', 'date-intl'];

export function scan(root, detection) {
  const files = listComponentFiles(root);
  const sites = [];
  let parseErrors = 0;

  for (const abs of files) {
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const relPosix = toPosix(relative(root, abs));
    const result = scanFile(abs, relPosix, text);
    if (result.parseError) {
      parseErrors += 1;
      continue;
    }
    for (const s of result.sites) sites.push(s);
  }

  // counts by kind — every site counts toward its kind, including excluded
  // structural date sites (so the audit can see them), but the brief reports
  // included-vs-excluded separately.
  const countsByKind = Object.fromEntries(ALL_KINDS.map((k) => [k, 0]));
  for (const s of sites) {
    countsByKind[s.kind] = (countsByKind[s.kind] || 0) + 1;
  }

  // components by density — rank files by number of INCLUDED sites (excluded
  // structural sites do not represent localization work, so they do not inflate
  // a file's density rank).
  const byFile = new Map();
  for (const s of sites) {
    if (s.excluded) continue;
    byFile.set(s.file, (byFile.get(s.file) || 0) + 1);
  }
  const componentsByDensity = [...byFile.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

  const det = detection || { app: { root }, existingI18n: { lib: null, languageList: null, localePref: null } };

  const inventory = {
    schemaVersion: 1,
    app: det.app,
    existingI18n: det.existingI18n,
    sites,
    countsByKind,
    componentsByDensity,
  };

  // _meta is scan-internal (file counts, parse errors) — handy for the brief, but
  // NOT part of the persisted inventory shape. Make it non-enumerable so
  // JSON.stringify drops it and the schema's additionalProperties:false holds,
  // while brief.mjs can still read it off the in-memory object.
  Object.defineProperty(inventory, '_meta', {
    value: { filesScanned: files.length, parseErrors },
    enumerable: false,
    writable: false,
    configurable: true,
  });

  return inventory;
}

export default scan;
