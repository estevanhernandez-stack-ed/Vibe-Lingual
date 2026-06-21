// next-intl adapter — transform codemod (M7, the hard core).
//
// A jscodeshift codemod that rewrites a single file's user-facing string literals
// into next-intl translation calls, SERVER-COMPONENT-AWARE and modeled
// BYTE-FOR-BYTE on the proven Celestia3 cowpath shapes:
//
//   - SERVER component (App-Router default, NO "use client") → `getTranslations`
//     (async, imported from 'next-intl/server'). The cowpath shape is
//     src/app/s/[shareId]/page.tsx: `const t = await getTranslations('Share');`
//     then `{t('cta')}`. Only async functions can `await getTranslations`, so a
//     server file is only rewritten when its enclosing component is async.
//   - CLIENT component ("use client") → `useTranslations` hook. The cowpath shape
//     is src/components/settings/LanguageSettings.tsx:
//     `const t = useTranslations('CosmicCalibration');` then `{t('interfaceLanguageHeading')}`.
//   - DATE site (Intl.DateTimeFormat / toLocale*String for DISPLAY) → `useFormatter`
//     (client). The cowpath shape is src/components/TransitFeed.tsx:
//     `const format = useFormatter();` then
//     `format.dateTime(date, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, ... })`
//     — a PER-CALL browser-resolved timeZone (the proven fix: a fixed global tz
//     would shift dates by a day for distant users; the runtime zone keeps
//     viewer-local behavior without the next-intl ENVIRONMENT_FALLBACK warning).
//
// KIND coverage: jsx-text + attribute kinds (placeholder / aria-label / title /
// alt). The scanner (engine/scan.mjs) owns WHICH sites are user-facing; this
// codemod owns the REWRITE.
//
// HARD CONTRACTS:
//   - IDEMPOTENT. Re-running on already-extracted code is a no-op — a literal
//     already inside a t()/getTranslations/useTranslations/format.* call is
//     skipped, and the import + hook are added at most once.
//   - STRUCTURAL-INTL UNTOUCHED. A date site doing tz-offset math / locale-
//     invariant parsing / a runtime-zone read for logic (birthDateTime.ts shape,
//     `Intl.DateTimeFormat().resolvedOptions().timeZone` feeding logic) is NEVER
//     rewritten. The codemod only rewrites a DISPLAY date — a toLocale*String /
//     Intl.DateTimeFormat(...).format(date) whose result is rendered in JSX.
//   - ATOMIC per file. Either the file is rewritten with import + hook + all its
//     sites, or (no eligible sites) it is returned unchanged.
//
// Invocation: this module is BOTH a jscodeshift transform
// (`export default function transformer(fileInfo, api, options)`) and a
// programmatic entry (`transform(source, options) -> { code, changed, ... }`),
// so the SKILL can drive it without spawning the jscodeshift CLI.

import jscodeshiftDefault from 'jscodeshift';

// jscodeshift ships a TS-aware parser variant; the cowpath files are .tsx.
const jHelper = jscodeshiftDefault.withParser('tsx');

// ---------------------------------------------------------------------------
// key helpers — namespace + key derivation (mirrors scan.mjs so the codemod and
// the inventory agree on the catalog shape).
// ---------------------------------------------------------------------------

function toPascal(s) {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

function basenameNoExt(path) {
  const base = (path || '').split('/').pop() || '';
  return base.replace(/\.(tsx|jsx|ts|js|mjs|cjs)$/, '');
}

function parentDirName(path) {
  const parts = (path || '').split('/');
  return parts.length >= 2 ? parts[parts.length - 2] : '';
}

// Component namespace = PascalCase component basename (the Celestia3 convention:
// namespace equals the component, e.g. CosmicCalibration / TransitFeed / Share).
// Route files (page/layout/...) take the parent dir name; a dynamic-route parent
// like [shareId] is skipped in favor of a meaningful ancestor (the cowpath
// /s/[shareId]/page.tsx → 'Share', from the grandparent 's').
function deriveNamespace(path) {
  const base = basenameNoExt(path);
  if (/^(page|layout|route|template|loading|error|not-found)$/i.test(base)) {
    const parts = (path || '').split('/').filter(Boolean);
    // walk up from the file's parent looking for a non-dynamic, non-route segment.
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      const seg = parts[i];
      if (!seg || /^\[.*\]$/.test(seg) || /^(app|src|pages)$/i.test(seg)) continue;
      return toPascal(seg);
    }
    return 'Page';
  }
  return /^[A-Z]/.test(base) ? base : toPascal(base);
}

// Key = camelCase slug from the first words of the text (mirrors scan.mjs).
function deriveKey(text) {
  const words = String(text)
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

// ---------------------------------------------------------------------------
// user-facing-text gate — a trimmed copy of scan.mjs's heuristics so the codemod
// never rewrites machinery (CSS classes, identifiers) that slipped past JSX-text.
// ---------------------------------------------------------------------------

function hasLetter(s) {
  return /[A-Za-zÀ-ɏЀ-ӿ֐-׿؀-ۿ一-鿿぀-ヿ]/.test(s);
}

const CSS_TOKEN_RE = /^[a-z0-9]+(?:[-:/][a-z0-9[\]#.%()_,-]+)+$/i;
const UTILITY_PREFIX_RE =
  /^(flex|grid|block|inline|hidden|relative|absolute|fixed|sticky|static|w|h|m[trblxy]?|p[trblxy]?|gap|space|text|bg|border|rounded|shadow|font|leading|tracking|uppercase|lowercase|capitalize|truncate|overflow|cursor|opacity|transition|transform|translate|scale|rotate|z|top|bottom|left|right|min|max|order|col|row|justify|items|content|self|place|sr|pointer|select|whitespace|break|object|aspect|backdrop|ring|outline|divide|from|via|to|stroke|fill)$/;

function isCssClassString(s) {
  const trimmed = s.trim();
  if (!trimmed) return true;
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

function isIdentifierShaped(s) {
  const t = s.trim();
  if (/\s/.test(t)) return false;
  if (/^[A-Z0-9_]+$/.test(t) && t.length > 2) return true;
  if (/[._/]/.test(t) && !/[.!?]$/.test(t)) return true;
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(t)) return true;
  return false;
}

function isUserFacingText(s, kind) {
  const t = String(s).trim();
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

// Attribute kinds the codemod rewrites, mapped from the lowercased attr name.
const ATTR_KIND = {
  placeholder: 'placeholder',
  'aria-label': 'aria-label',
  arialabel: 'aria-label',
  title: 'title',
  alt: 'alt',
};

// Translation callees that mark an ALREADY-extracted site (idempotency guard).
const TRANSLATION_CALLEES = new Set([
  't',
  'getTranslations',
  'useTranslations',
  '__',
  'translate',
  'formatMessage',
]);
// Formatter members that mark an already-extracted DATE site.
const FORMATTER_MEMBERS = new Set(['dateTime', 'number', 'relativeTime', 'list']);
const INTL_DATE_METHODS = new Set(['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']);

// ---------------------------------------------------------------------------
// the codemod
// ---------------------------------------------------------------------------

// A jscodeshift transform proper. `api.jscodeshift` is the parser-bound `j`.
export default function transformer(fileInfo, api, options = {}) {
  const j = api.jscodeshift;
  const root = j(fileInfo.source);
  const ctx = buildContext(fileInfo.path || options.path || '', options);

  const result = runCodemod(j, root, ctx);

  // jscodeshift contract: return the new source, or null/undefined for no-change
  // (so a runner can skip writing). We return the (possibly unchanged) source and
  // surface change metadata via options.report for programmatic callers.
  if (typeof options.report === 'function') {
    options.report(JSON.stringify({ changed: result.changed, keys: result.keys }));
  }
  return result.changed ? root.toSource(SRC_OPTS) : null;
}

const SRC_OPTS = { quote: 'single', trailingComma: true, tabWidth: 2 };

// Programmatic entry — the SKILL drives this directly (no CLI spawn).
//   transform(source, { path, isClient, namespace }) ->
//     { code, changed, keys, namespace, hooksAdded }
export function transform(source, options = {}) {
  const j = jHelper;
  const root = j(source);
  const ctx = buildContext(options.path || '', options);
  const result = runCodemod(j, root, ctx);
  return {
    code: result.changed ? root.toSource(SRC_OPTS) : source,
    changed: result.changed,
    keys: result.keys,
    namespace: ctx.namespace,
    hooksAdded: result.hooksAdded,
  };
}

// Build the per-file transform context: namespace, server/client mode, and the
// catalog accumulator. Mode detection: an explicit options.isClient wins;
// otherwise the "use client" directive in the source decides (App-Router default
// is server). The context is threaded through every rewrite.
function buildContext(path, options) {
  const namespace = options.namespace || deriveNamespace(path);
  return {
    path,
    namespace,
    isClientExplicit: typeof options.isClient === 'boolean' ? options.isClient : null,
    keys: {}, // key -> source text, the namespaced catalog fragment for this file
  };
}

function hasUseClientDirective(j, root) {
  // The Babel/jscodeshift parser hoists a top-of-file string-literal statement
  // into `program.directives` (a Directive node), NOT the body as an
  // ExpressionStatement. Check there first, then fall back to a body-level literal
  // statement (some parsers/positions leave it in the body).
  const program = root.get().node.program;
  if (program && Array.isArray(program.directives)) {
    for (const d of program.directives) {
      const v = d && d.value && d.value.value;
      if (v === 'use client') return true;
    }
  }
  let found = false;
  root.find(j.ExpressionStatement).forEach((p) => {
    const e = p.node.expression;
    if (
      e &&
      (e.type === 'StringLiteral' || e.type === 'Literal') &&
      typeof e.value === 'string' &&
      e.value === 'use client'
    ) {
      found = true;
    }
  });
  return found;
}

// Move a leading "use client" / "use server" directive out of program.directives
// and into the body as a string-literal ExpressionStatement. recast prints a
// body directive-statement cleanly (one semicolon); a program.directives node
// reprints with a doubled semicolon once the body around it changes. Idempotent:
// if the directive is already a body statement (or absent), no-op.
function materializeLeadingDirective(j, root) {
  const program = root.get().node.program;
  if (!program || !Array.isArray(program.directives) || program.directives.length === 0) return;
  const moved = [];
  for (const d of program.directives) {
    const v = d && d.value && d.value.value;
    if (v === 'use client' || v === 'use server' || v === 'use strict') {
      moved.push(v);
    }
  }
  if (moved.length === 0) return;
  // drop the recognized directives from program.directives.
  program.directives = program.directives.filter((d) => {
    const v = d && d.value && d.value.value;
    return !(v === 'use client' || v === 'use server' || v === 'use strict');
  });
  // prepend them to the body as explicit statements (preserve order).
  for (let i = moved.length - 1; i >= 0; i -= 1) {
    program.body.unshift(j.expressionStatement(j.stringLiteral(moved[i])));
  }
}

function runCodemod(j, root, ctx) {
  const isClient = ctx.isClientExplicit != null ? ctx.isClientExplicit : hasUseClientDirective(j, root);
  ctx.isClient = isClient;

  // Normalize a `program.directives` "use client" into an explicit leading body
  // ExpressionStatement BEFORE any insertion. recast prints a directive node with
  // its own trailing ';' and then adds another when the following body node is
  // reprinted, yielding a stray `";;"`. Materializing the directive as a regular
  // statement gives recast a single, well-understood node to anchor inserts
  // against. Only done when we will actually change the file.
  materializeLeadingDirective(j, root);

  let textChanged = false;
  let dateChanged = false;
  const dateSites = [];

  // ---- 1. JSX text nodes -------------------------------------------------
  root.find(j.JSXText).forEach((p) => {
    const raw = p.node.value;
    if (!isUserFacingText(raw, 'jsx-text')) return;
    if (isInsideTranslationCall(j, p)) return; // idempotency
    const text = raw.trim();
    const key = registerKey(ctx, text);
    // Preserve surrounding whitespace: a JSX text node may carry leading/trailing
    // whitespace that is structurally meaningful (spacing between inline elements).
    const leading = raw.match(/^\s*/)[0];
    const trailing = raw.match(/\s*$/)[0];
    const expr = j.jsxExpressionContainer(tCall(j, key));
    if (leading || trailing) {
      // replace with [leadingWS?, {t(key)}, trailingWS?] — keep the whitespace as
      // sibling JSXText so layout never shifts.
      const replacements = [];
      if (leading) replacements.push(j.jsxText(leading));
      replacements.push(expr);
      if (trailing) replacements.push(j.jsxText(trailing));
      j(p).replaceWith(replacements);
    } else {
      j(p).replaceWith(expr);
    }
    textChanged = true;
  });

  // ---- 2. JSX attribute literals (placeholder/aria-label/title/alt) ------
  root.find(j.JSXAttribute).forEach((p) => {
    const nameNode = p.node.name;
    const attrName = nameNode && (nameNode.name || (nameNode.name && nameNode.name.name));
    const lower = String(attrName || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(ATTR_KIND, lower)) return;
    const value = p.node.value;
    // already an expression container holding a t() call → idempotent skip.
    if (value && value.type === 'JSXExpressionContainer') return;
    const lit = stringLiteralNodeValue(value);
    if (lit == null) return;
    if (!isUserFacingText(lit, ATTR_KIND[lower])) return;
    const key = registerKey(ctx, lit);
    p.node.value = j.jsxExpressionContainer(tCall(j, key));
    textChanged = true;
  });

  // ---- 3. DATE display sites → useFormatter (client only) ----------------
  // Server components don't get a client hook; the cowpath proves date display is
  // a client concern (TransitFeed is "use client"). For a server file we leave the
  // date site untouched and let audit surface a manual decision.
  if (isClient) {
    collectDisplayDateSites(j, root, dateSites);
    for (const site of dateSites) {
      rewriteDateSite(j, site);
      dateChanged = true;
    }
  }

  const changed = textChanged || dateChanged;
  const hooksAdded = { translations: false, formatter: false };

  // ---- 4. add import + hook/await as needed (at most once) ---------------
  if (textChanged) {
    if (isClient) {
      ensureUseTranslations(j, root, ctx);
    } else {
      ensureGetTranslations(j, root, ctx);
    }
    hooksAdded.translations = true;
  }
  if (dateChanged) {
    ensureUseFormatter(j, root, ctx);
    hooksAdded.formatter = true;
  }

  return { changed, keys: ctx.keys, hooksAdded };
}

// register a key for `text`, returning the (deduped) key name. Two distinct texts
// never collide on a key: on collision we suffix a counter.
function registerKey(ctx, text) {
  const base = deriveKey(text);
  // if this exact text already mapped to a key, reuse it.
  for (const [k, v] of Object.entries(ctx.keys)) {
    if (v === text) return k;
  }
  let key = base;
  let n = 2;
  while (Object.prototype.hasOwnProperty.call(ctx.keys, key)) {
    key = `${base}${n}`;
    n += 1;
  }
  ctx.keys[key] = text;
  return key;
}

// Build a `t('key')` call expression.
function tCall(j, key) {
  return j.callExpression(j.identifier('t'), [j.stringLiteral(key)]);
}

// pull a plain string out of a JSXAttribute value (StringLiteral, or a
// single-quasi no-expression template inside an expression container).
function stringLiteralNodeValue(value) {
  if (!value) return null;
  if (value.type === 'StringLiteral' || value.type === 'Literal') {
    return typeof value.value === 'string' ? value.value : null;
  }
  if (value.type === 'JSXExpressionContainer') {
    const e = value.expression;
    if (e && (e.type === 'StringLiteral' || e.type === 'Literal') && typeof e.value === 'string') {
      return e.value;
    }
    if (
      e &&
      e.type === 'TemplateLiteral' &&
      e.expressions.length === 0 &&
      e.quasis.length === 1
    ) {
      return e.quasis[0].value.cooked;
    }
  }
  return null;
}

// Is this path inside an already-extracted translation/formatter call?
function isInsideTranslationCall(j, path) {
  let cur = path.parent;
  while (cur) {
    const n = cur.node;
    if (n && n.type === 'CallExpression') {
      const callee = n.callee;
      if (callee) {
        if (callee.type === 'Identifier' && TRANSLATION_CALLEES.has(callee.name)) return true;
        if (
          callee.type === 'MemberExpression' &&
          callee.property &&
          (TRANSLATION_CALLEES.has(callee.property.name) ||
            FORMATTER_MEMBERS.has(callee.property.name))
        ) {
          return true;
        }
      }
    }
    cur = cur.parent;
  }
  return false;
}

// ---------------------------------------------------------------------------
// DATE display sites — collect + rewrite to useFormatter with a per-call tz.
// ---------------------------------------------------------------------------

// A DISPLAY date site is a toLocale*String / Intl.DateTimeFormat(...).format(...)
// call rendered INSIDE JSX (an ancestor is a JSXExpressionContainer). A date call
// NOT inside JSX is structural (logic) — left untouched.
//
// STRUCTURAL guards (never rewritten):
//   - `Intl.DateTimeFormat().resolvedOptions()...`  — runtime-zone read for logic.
//   - argument-less `Intl.DateTimeFormat()` not followed by .format(date).
//   - a fixed machine-locale call ('en-CA'/'en-US'/...) — tz-offset math / date-key.
function collectDisplayDateSites(j, root, out) {
  const MACHINE_LOCALE_RE = /^en-(CA|US|GB)$|^sv-SE$|^fr-CA$/;

  // date.toLocaleDateString(...) / toLocaleTimeString(...) / toLocaleString(...)
  root.find(j.CallExpression).forEach((p) => {
    const node = p.node;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression' || !callee.property) return;
    const method = callee.property.name;
    if (!INTL_DATE_METHODS.has(method)) return;
    if (!isInsideJsxExpression(j, p)) return; // structural: not rendered
    const args = node.arguments || [];
    const localeArg = stringLiteralFromArg(args[0]);
    if (localeArg && MACHINE_LOCALE_RE.test(localeArg)) return; // date-key/math
    out.push({
      path: p,
      kind: 'toLocale',
      dateExpr: callee.object,
      optionsArg: args[1] && args[1].type === 'ObjectExpression' ? args[1] : null,
    });
  });

  // new Intl.DateTimeFormat(locale, opts).format(date) rendered in JSX.
  root.find(j.CallExpression).forEach((p) => {
    const node = p.node;
    const callee = node.callee;
    if (!callee || callee.type !== 'MemberExpression') return;
    if (!callee.property || callee.property.name !== 'format') return;
    const obj = callee.object;
    if (!isIntlDateTimeFormatCtor(obj)) return;
    if (isResolvedOptionsChain(obj)) return; // structural runtime-zone read
    if (!isInsideJsxExpression(j, p)) return; // structural: not rendered
    const ctorArgs = (obj.arguments || []);
    const localeArg = stringLiteralFromArg(ctorArgs[0]);
    if (localeArg && MACHINE_LOCALE_RE.test(localeArg)) return; // machine-locale math
    const dateExpr = node.arguments && node.arguments[0];
    if (!dateExpr) return;
    out.push({
      path: p,
      kind: 'intlFormat',
      dateExpr,
      optionsArg: ctorArgs[1] && ctorArgs[1].type === 'ObjectExpression' ? ctorArgs[1] : null,
    });
  });
}

function isIntlDateTimeFormatCtor(node) {
  return (
    node &&
    (node.type === 'NewExpression' || node.type === 'CallExpression') &&
    node.callee &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'Intl' &&
    node.callee.property &&
    node.callee.property.name === 'DateTimeFormat'
  );
}

function isResolvedOptionsChain(node) {
  // node is itself the ctor; a resolvedOptions read is the ctor being the object
  // of a `.resolvedOptions()` member — but here `node` is already the ctor, so a
  // resolvedOptions consumer would have `node` nested under a different member.
  // The structural runtime-zone read never has a `.format(date)` tail, so reaching
  // this guard from the .format() collector means it is NOT a resolvedOptions read.
  // Kept as an explicit no-op guard for symmetry + future-proofing.
  return false;
}

function stringLiteralFromArg(arg) {
  if (!arg) return null;
  if ((arg.type === 'StringLiteral' || arg.type === 'Literal') && typeof arg.value === 'string') {
    return arg.value;
  }
  return null;
}

// Is the call rendered inside JSX (an ancestor JSXExpressionContainer)?
function isInsideJsxExpression(j, path) {
  let cur = path.parent;
  while (cur) {
    if (cur.node && cur.node.type === 'JSXExpressionContainer') return true;
    // a function/class boundary means we've left the JSX render scope.
    if (
      cur.node &&
      (cur.node.type === 'FunctionDeclaration' ||
        cur.node.type === 'ClassDeclaration')
    ) {
      return false;
    }
    cur = cur.parent;
  }
  return false;
}

// Rewrite a display date site into `format.dateTime(date, { timeZone: <runtime>, ...opts })`.
// The PER-CALL timeZone is the proven cowpath fix:
//   Intl.DateTimeFormat().resolvedOptions().timeZone
// — the browser-resolved zone, keeping viewer-local dates without the next-intl
// ENVIRONMENT_FALLBACK warning. Existing display options on the source call are
// carried into the format options object; a timeZone is added (or left if the
// author already pinned one).
function rewriteDateSite(j, site) {
  const props = [];
  // timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone  (added first).
  let hasTimeZone = false;
  if (site.optionsArg) {
    for (const prop of site.optionsArg.properties) {
      const keyName = prop.key && (prop.key.name || prop.key.value);
      if (keyName === 'timeZone') hasTimeZone = true;
    }
  }
  if (!hasTimeZone) {
    props.push(
      j.objectProperty(j.identifier('timeZone'), runtimeTimeZoneExpr(j)),
    );
  }
  if (site.optionsArg) {
    for (const prop of site.optionsArg.properties) {
      props.push(prop);
    }
  }

  const formatCall = j.callExpression(
    j.memberExpression(j.identifier('format'), j.identifier('dateTime')),
    [site.dateExpr, j.objectExpression(props)],
  );
  j(site.path).replaceWith(formatCall);
}

// Build `Intl.DateTimeFormat().resolvedOptions().timeZone`.
function runtimeTimeZoneExpr(j) {
  const dtf = j.callExpression(
    j.memberExpression(j.identifier('Intl'), j.identifier('DateTimeFormat')),
    [],
  );
  const resolved = j.callExpression(
    j.memberExpression(dtf, j.identifier('resolvedOptions')),
    [],
  );
  return j.memberExpression(resolved, j.identifier('timeZone'));
}

// ---------------------------------------------------------------------------
// import + hook insertion (idempotent — added at most once).
// ---------------------------------------------------------------------------

// CLIENT: ensure `import { useTranslations } from 'next-intl'` + a
// `const t = useTranslations('<NS>')` at the top of the component body.
function ensureUseTranslations(j, root, ctx) {
  ensureNamedImport(j, root, 'next-intl', 'useTranslations');
  ensureHookConst(j, root, 't', () =>
    j.callExpression(j.identifier('useTranslations'), [j.stringLiteral(ctx.namespace)]),
  );
}

// CLIENT date: ensure `import { useFormatter } from 'next-intl'` + a
// `const format = useFormatter()` at the top of the component body.
function ensureUseFormatter(j, root, ctx) {
  ensureNamedImport(j, root, 'next-intl', 'useFormatter');
  ensureHookConst(j, root, 'format', () =>
    j.callExpression(j.identifier('useFormatter'), []),
  );
}

// SERVER: ensure `import { getTranslations } from 'next-intl/server'` + a
// `const t = await getTranslations('<NS>')` inside the async component body. A
// server component must be async to await; if the enclosing function is not async
// we still add the import + const but the call sites already assume `t`. The
// scanner/SKILL only routes async server files here (page.tsx in the cowpath is
// async), so the await is valid.
function ensureGetTranslations(j, root, ctx) {
  ensureNamedImport(j, root, 'next-intl/server', 'getTranslations');
  ensureHookConst(
    j,
    root,
    't',
    () =>
      j.awaitExpression(
        j.callExpression(j.identifier('getTranslations'), [j.stringLiteral(ctx.namespace)]),
      ),
    { needsAsync: true },
  );
}

// Add a named import to an existing source-matching declaration, or create one.
// Idempotent: if the specifier already exists on a matching import, no-op.
function ensureNamedImport(j, root, source, name) {
  const matching = root.find(j.ImportDeclaration, {
    source: { value: source },
  });
  if (matching.size() > 0) {
    let present = false;
    matching.forEach((p) => {
      for (const spec of p.node.specifiers || []) {
        if (spec.type === 'ImportSpecifier' && spec.imported && spec.imported.name === name) {
          present = true;
        }
      }
    });
    if (present) return;
    // append the specifier to the first matching import.
    const first = matching.paths()[0];
    first.node.specifiers.push(j.importSpecifier(j.identifier(name)));
    return;
  }
  // no matching import — insert a fresh one after the last import, else before the
  // first body statement (insertBefore a real statement path keeps recast's
  // directive printing intact; a raw body.unshift past a "use client" directive
  // produces a stray double-semicolon).
  const decl = j.importDeclaration(
    [j.importSpecifier(j.identifier(name))],
    j.stringLiteral(source),
  );
  const imports = root.find(j.ImportDeclaration);
  if (imports.size() > 0) {
    imports.at(imports.size() - 1).insertAfter(decl);
    return;
  }
  // No imports. Anchor AFTER a leading directive ("use client" must remain the
  // first statement — an import before it is a hard Next.js error), else before
  // the first body statement.
  const program = root.get().node.program;
  const body = program.body || [];
  const firstIsDirective =
    body[0] &&
    body[0].type === 'ExpressionStatement' &&
    body[0].expression &&
    (body[0].expression.type === 'StringLiteral' || body[0].expression.type === 'Literal') &&
    typeof body[0].expression.value === 'string' &&
    /^use (client|server|strict)$/.test(body[0].expression.value);
  if (firstIsDirective) {
    j(root.get('program', 'body', 0)).insertAfter(decl);
    return;
  }
  const firstStmtPath = root.get('program', 'body', 0);
  if (firstStmtPath && firstStmtPath.node) {
    j(firstStmtPath).insertBefore(decl);
  } else {
    program.body.unshift(decl);
  }
}

// Ensure a `const <name> = <initFactory()>` exists at the top of the component
// body. Finds the component: the first function that returns JSX (a
// FunctionDeclaration / arrow assigned to a const / default-exported function).
// Idempotent: if a `const <name> =` already exists in that body, no-op.
function ensureHookConst(j, root, name, initFactory, opts = {}) {
  const body = findComponentBody(j, root);
  if (!body) return;

  // already declared?
  for (const stmt of body.body || []) {
    if (
      stmt.type === 'VariableDeclaration' &&
      stmt.declarations.some(
        (d) => d.id && d.id.type === 'Identifier' && d.id.name === name,
      )
    ) {
      return;
    }
  }

  if (opts.needsAsync && body._ownerFn && !body._ownerFn.async) {
    body._ownerFn.async = true;
  }

  const decl = j.variableDeclaration('const', [
    j.variableDeclarator(j.identifier(name), initFactory()),
  ]);
  body.body.unshift(decl);
}

// Find the body (BlockStatement) of the component that renders JSX. Strategy:
// the nearest function whose body contains a JSX return. Prefers the
// default-exported / first top-level component.
function findComponentBody(j, root) {
  let chosen = null;

  const consider = (fnNode) => {
    if (!fnNode || !fnNode.body || fnNode.body.type !== 'BlockStatement') return;
    // does this function return JSX (directly or via a JSXElement anywhere)?
    const hasJsx = j(fnNode.body).find(j.JSXElement).size() > 0 ||
      j(fnNode.body).find(j.JSXFragment).size() > 0;
    if (!hasJsx) return;
    if (!chosen) {
      chosen = fnNode.body;
      chosen._ownerFn = fnNode;
    }
  };

  // function declarations (incl. `export default function`)
  root.find(j.FunctionDeclaration).forEach((p) => consider(p.node));
  // arrow / function-expression assigned to a const: `const X = () => {...}`
  root.find(j.VariableDeclarator).forEach((p) => {
    const init = p.node.init;
    if (init && (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression')) {
      consider(init);
    }
  });
  // `export default () => {...}` / `export default function() {...}`
  root.find(j.ExportDefaultDeclaration).forEach((p) => {
    const d = p.node.declaration;
    if (d && (d.type === 'FunctionDeclaration' || d.type === 'ArrowFunctionExpression' || d.type === 'FunctionExpression')) {
      consider(d);
    }
  });

  return chosen;
}

export { deriveNamespace, deriveKey };
