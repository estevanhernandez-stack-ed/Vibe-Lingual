// vibe-lingual engine — i18n-retrofit audit (M4).
//
// Pure analysis. Takes a scan `inventory` (the M2 output) plus the app root (so
// the one source-dependent rule — firebase-admin-in-SSR — can read the SSR files
// it inventory already named) and emits an `audit` object matching the audit.json
// shape in spec.md:
//
//   gotchas[]    — the retrofit traps, each {type,file,line,severity,recommendation}
//   decisions[]  — per-app choices the plugin must SURFACE, never auto-resolve
//                  (the timeZone decision is REQUIRED, not silently picked)
//   readiness[]  — per-file ready|blocked + reason (drives localize ordering)
//   phasedPlan[] — extract → wire → translate → wire-to-locale → guard
//
// The five gotcha rules (docs/inputs/cowpath-seed.md §6):
//   1. firebase-admin-ssr   — a firebase-admin import in an App Router page/layout.
//      firebase-admin is banned in Turbopack SSR (only safe in functions/); a
//      locale loader must NOT mount where firebase-admin is imported. BLOCK.
//   2. structural-intl       — the scan-time structural `Intl` exclusions, restated
//      as an audit-time confirmation gate. Extracting them corrupts logic. INFO
//      (already excluded by scan; surfaced so the team confirms the call).
//   3. timezone              — a REQUIRED decision, never auto-resolved. Client
//      local dates want the browser zone; SSR dates need an explicit tz. WARN +
//      a decisions[] entry with required:true.
//   4. rtl                   — the layout assumes LTR. Flag before adding Arabic /
//      Hebrew / Urdu. INFO (readiness flag, no blocker until an RTL locale lands).
//   5. dynamic-route-glob    — App Router `[param]` segment dirs: ESLint flat-config
//      treats `[param]` as a minimatch char class, so a guard `files` entry SILENTLY
//      never matches. The guard must glob the segment with `*`. WARN.
//
// No mutation, no network. Source reads are guarded (missing files degrade, never
// throw). The audit is read-only — localize is the only mutating step.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// firebase-admin import detection — the only source-dependent rule.
// firebase-admin is the package; the ban covers `firebase-admin` and its
// subpath entrypoints (`firebase-admin/app`, `firebase-admin/firestore`, ...).
// We match import/require of the package by string, not by AST, to stay cheap
// and to catch both ESM `import` and CJS `require`. A comment mentioning the
// package is not an import — require a real import/require form.
// ---------------------------------------------------------------------------

const FIREBASE_ADMIN_IMPORT_RE =
  /(?:import[^;]*?from\s*|require\s*\(\s*)['"]firebase-admin(?:\/[^'"]*)?['"]/;

// Find the 1-based line of the first firebase-admin import in `text`, or 0.
function firebaseAdminImportLine(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (FIREBASE_ADMIN_IMPORT_RE.test(lines[i])) return i + 1;
  }
  return 0;
}

// An App Router SSR surface is a page/layout (the locale-loader mount points).
function isSsrSurface(relPosix) {
  return /(^|\/)(page|layout)\.(tsx|jsx|ts|js)$/.test(relPosix);
}

// A dynamic-route file carries a `[param]` segment dir — the ESLint-glob trap.
function isDynamicRoute(relPosix) {
  return /\[[^/\]]+\]/.test(relPosix);
}

// Replace each `[param]` segment with `*` for a glob the ESLint flat-config will
// actually match (minimatch treats `[...]` as a char class). e.g.
//   src/app/s/[shareId]/page.tsx  →  src/app/s/*/page.tsx
function globSafe(relPosix) {
  return relPosix.replace(/\[[^/\]]+\]/g, '*');
}

// ---------------------------------------------------------------------------
// gotcha builders. Each returns zero or more gotcha objects; the engine flattens
// them, dedupes nothing (each is a distinct site), and sorts for stable output.
// ---------------------------------------------------------------------------

function firebaseAdminGotchas(inv, appRoot) {
  const out = [];
  if (!appRoot) return out; // no source to read → skip the only source-dependent rule
  const ssrFiles = (inv.app && inv.app.ssrFiles) || [];
  for (const rel of ssrFiles) {
    if (!isSsrSurface(rel)) continue;
    let text;
    try {
      text = readFileSync(join(appRoot, rel), 'utf8');
    } catch {
      continue; // file gone since scan — degrade, never throw
    }
    const line = firebaseAdminImportLine(text);
    if (line > 0) {
      out.push({
        type: 'firebase-admin-ssr',
        file: rel,
        line,
        severity: 'block',
        recommendation:
          `\`${rel}\` imports firebase-admin, which is banned in Turbopack SSR (safe only in \`functions/\`). ` +
          `Do NOT mount the next-intl locale loader here — move the admin call to a server action / functions endpoint, ` +
          `or load the locale in a child server component that does not pull firebase-admin into the SSR module graph.`,
      });
    }
  }
  return out;
}

function structuralIntlGotchas(inv) {
  const out = [];
  for (const s of inv.sites) {
    if (!s.excluded) continue; // only the scan-time structural exclusions
    out.push({
      type: 'structural-intl',
      file: s.file,
      line: s.line,
      severity: 'info',
      recommendation:
        `\`${s.file}:${s.line}\` is structural \`Intl\` (${s.excludedReason || 'locale-invariant logic'}), ` +
        `NOT display copy. Confirm before any extraction — wrapping it in \`t()\` / rewriting to \`useFormatter\` ` +
        `corrupts the calculation. The scanner excluded it; this is the audit-time confirmation gate (KTD-5).`,
    });
  }
  return out;
}

// Presentational date-intl sites (included, not excluded) are the ones that need
// a useFormatter rewrite — and that rewrite needs a timeZone choice. Each such
// site emits a `timezone` WARN; the decisions[] entry (built separately) is the
// REQUIRED choice the plugin surfaces rather than auto-resolving.
function presentationalDateSites(inv) {
  return inv.sites.filter((s) => s.kind === 'date-intl' && !s.excluded);
}

function timezoneGotchas(inv) {
  const out = [];
  for (const s of presentationalDateSites(inv)) {
    out.push({
      type: 'timezone',
      file: s.file,
      line: s.line,
      severity: 'warn',
      recommendation:
        `\`${s.file}:${s.line}\` is a presentational locale-sensitive date. Its \`useFormatter\` rewrite needs a ` +
        `timeZone decision (see decisions[].timezone) — do NOT auto-resolve. Client-rendered local dates want the ` +
        `browser zone (a global fixed tz shifts dates a day for distant users); SSR-rendered dates need an explicit tz.`,
    });
  }
  return out;
}

function rtlGotchas() {
  // RTL is a whole-layout property, not a per-file site — one app-level INFO.
  return [
    {
      type: 'rtl',
      file: null,
      line: 0,
      severity: 'info',
      recommendation:
        'The layout assumes LTR. No RTL work is needed for LTR locales, but flag this BEFORE adding Arabic, Hebrew, ' +
        'or Urdu: those need `dir="rtl"` on the document and an RTL-aware layout pass. Surfaced now so it is not a ' +
        'surprise when an RTL locale is requested.',
    },
  ];
}

function dynamicRouteGotchas(inv) {
  const out = [];
  const ssrFiles = (inv.app && inv.app.ssrFiles) || [];
  for (const rel of ssrFiles) {
    if (!isDynamicRoute(rel)) continue;
    out.push({
      type: 'dynamic-route-glob',
      file: rel,
      line: 0,
      severity: 'warn',
      recommendation:
        `\`${rel}\` is a dynamic route. ESLint flat-config treats the \`[param]\` segment as a minimatch char class, ` +
        `so a guard \`files\` entry with the literal path SILENTLY never matches. The guard emitter must glob the ` +
        `segment with \`*\` (use \`${globSafe(rel)}\`) and verify the rule resolves via \`eslint --print-config\`.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// decisions — the choices the plugin SURFACES, never auto-resolves.
//   timezone     — REQUIRED whenever any presentational date site exists. The
//                  cowpath's load-bearing "surface, don't auto-resolve" rule.
//   dual-locale  — surfaced when the app already controls an output/content locale
//                  (existingI18n.localePref present): UI locale must be modeled
//                  SEPARATELY from content locale (they don't move in lockstep).
//   html-lang    — the `<html lang="en">` → `lang={locale}` change, surfaced when
//                  an App Router layout SSR file exists.
// ---------------------------------------------------------------------------

function buildDecisions(inv) {
  const out = [];
  const dateSites = presentationalDateSites(inv);

  if (dateSites.length > 0) {
    out.push({
      id: 'timezone',
      question:
        'How should locale-sensitive dates resolve their timeZone? next-intl warns ENVIRONMENT_FALLBACK with no ' +
        'explicit timeZone. This is a REQUIRED per-app choice — the plugin will NOT auto-resolve it.',
      options: [
        'client-browser-zone — pass the browser-resolved zone per call (Intl.DateTimeFormat().resolvedOptions().timeZone); correct for client-rendered LOCAL dates (a global fixed tz shifts dates a day for distant users)',
        'ssr-explicit-zone — set an explicit timeZone in the request config; needed for SSR-rendered dates so server + client agree',
        'mixed — browser zone for client-local dates, explicit zone for SSR dates (the most common real answer)',
      ],
      recommended:
        'mixed — browser zone for client-local dates, explicit zone for SSR-rendered dates. Tests pin timeZone="UTC" for determinism only.',
      required: true,
      rationale:
        `${dateSites.length} presentational date site(s) need a useFormatter rewrite; each rewrite needs this choice. ` +
        'A wrong global tz silently shifts dates by a day for distant viewers — too consequential to auto-pick.',
    });
  }

  const pref = inv.existingI18n && inv.existingI18n.localePref;
  if (pref) {
    out.push({
      id: 'dual-locale',
      question:
        `The app already declares a locale preference (\`${pref.symbol}\` in \`${pref.file}\`). If that controls AI / ` +
        'content OUTPUT, should the new UI locale move in lockstep with it, or be a separate preference?',
      options: [
        'separate — model uiLanguage (chrome) SEPARATELY from the existing content/output locale (they do not move in lockstep; one picker controls AI generation, the other controls UI)',
        'lockstep — one preference drives both UI and content language (only correct if the existing pref is genuinely a UI locale, not an output-language control)',
      ],
      recommended:
        'separate — reuse the existing language list for the picker, but store uiLanguage as its own preference. Lockstep is almost always wrong when the existing pref is an output-language control.',
      required: false,
      rationale:
        'The cowpath lesson: an app with output-language control must model UI locale separately or the two concerns collide.',
    });
  }

  const layoutSsr = ((inv.app && inv.app.ssrFiles) || []).filter((f) =>
    /(^|\/)layout\.(tsx|jsx|ts|js)$/.test(f),
  );
  if (layoutSsr.length > 0) {
    out.push({
      id: 'html-lang',
      question:
        `The root layout (\`${layoutSsr[0]}\`) likely hardcodes \`<html lang="en">\`. Update it to \`lang={locale}\` ` +
        '(async layout + next-intl `getLocale()`) so the document language matches the rendered locale?',
      options: [
        'yes — make the layout async and set lang={locale} via getLocale() (correct: screen readers and the browser read the document language from this attribute)',
        'defer — keep lang="en" for now; revisit in the Phase-3 full pass',
      ],
      recommended:
        'yes — set lang={locale}. A hardcoded lang="en" while rendering es/ja is an accessibility + correctness bug.',
      required: false,
      rationale: 'A static lang attribute mislabels the document language for every non-English render.',
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// per-file readiness — ready|blocked + reason. Drives localize's file ordering.
// A file is BLOCKED when wiring/extraction there is unsafe:
//   - it is an SSR surface importing firebase-admin (locale loader can't mount), OR
//   - it is a dynamic-route file (needs the `*`-glob guard handling first).
// Otherwise it is READY. Only files that carry INCLUDED localization work appear
// (structural-Intl-only files carry no work — they are not in the surface).
// SSR surfaces with localization work that are blocked still appear (so the team
// sees why they are held).
// ---------------------------------------------------------------------------

function buildReadiness(inv, firebaseBlockedFiles, dynamicRouteFiles) {
  // files with INCLUDED localization work, by site count (componentsByDensity is
  // already that set, ranked — reuse it for a stable order).
  const workFiles = new Map();
  for (const c of inv.componentsByDensity) workFiles.set(c.file, c.count);

  // an SSR file blocked by firebase-admin may have zero included sites (the block
  // is structural, not work-driven) but must still be reported as blocked.
  for (const f of firebaseBlockedFiles) {
    if (!workFiles.has(f)) workFiles.set(f, 0);
  }

  const out = [];
  for (const [file, count] of workFiles) {
    if (firebaseBlockedFiles.has(file)) {
      out.push({
        file,
        status: 'blocked',
        reason:
          'imports firebase-admin in an App Router SSR surface — a locale loader cannot mount here (firebase-admin ' +
          'is banned in Turbopack SSR). Resolve the import before extraction/wiring.',
        siteCount: count,
      });
    } else if (dynamicRouteFiles.has(file)) {
      out.push({
        file,
        status: 'blocked',
        reason:
          'dynamic-route file — extract its strings, but the jsx-no-literals guard for it must glob the `[param]` ' +
          'segment with `*` (the literal path silently never matches). Held until the guard handles the glob.',
        siteCount: count,
      });
    } else {
      out.push({
        file,
        status: 'ready',
        reason:
          count > 0
            ? `${count} included site(s); no blocker — ready to extract → wire → guard.`
            : 'no blocker.',
        siteCount: count,
      });
    }
  }

  // stable: blocked first (they need attention), then by descending site count,
  // then by file path.
  out.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'blocked' ? -1 : 1;
    return b.siteCount - a.siteCount || a.file.localeCompare(b.file);
  });
  return out;
}

// ---------------------------------------------------------------------------
// phased plan — extract → wire → translate → wire-to-locale → guard. Each phase
// carries concrete items grounded in this app's inventory + gotchas.
// ---------------------------------------------------------------------------

function buildPhasedPlan(inv, gotchas, decisions) {
  const includedSites = inv.sites.filter((s) => !s.excluded);
  const dateSites = presentationalDateSites(inv);
  const fileCount = inv.componentsByDensity.length;
  const blockers = gotchas.filter((g) => g.severity === 'block');
  const dynamicRoutes = gotchas.filter((g) => g.type === 'dynamic-route-glob');
  const pref = inv.existingI18n && inv.existingI18n.localePref;
  const langList = inv.existingI18n && inv.existingI18n.languageList;

  const extract = [
    `${includedSites.length} string site(s) across ${fileCount} file(s) — ratchet one fully-extracted file at a time.`,
  ];
  if (blockers.length > 0) {
    extract.push(
      `${blockers.length} file(s) BLOCKED by firebase-admin in SSR — resolve those imports before extracting there.`,
    );
  }
  if (inv.sites.some((s) => s.excluded)) {
    extract.push(
      `Skip the ${inv.sites.filter((s) => s.excluded).length} structural \`Intl\` site(s) (date-key / tz math) — extracting them corrupts logic.`,
    );
  }

  const wire = [
    'Emit the next-intl request config with an AVAILABLE-list guard + try/catch `en` fallback (a selected-but-missing catalog must never crash the request).',
    'Add the locale cookie + provider mount.',
    'Patch jest `transformIgnorePatterns` to allow next-intl|use-intl|intl-messageformat|@formatjs (i18n libs are ESM-only — the existing suite breaks otherwise).',
  ];
  for (const b of blockers) {
    wire.push(`Do NOT mount the locale loader in \`${b.file}\` (firebase-admin SSR import).`);
  }

  const translate = [
    langList
      ? `Reuse the existing language list \`${langList.symbol}\` (\`${langList.file}\`) for the UI locale picker — do not generate a parallel list.`
      : 'Generate catalogs for the target locales (no existing language list detected to reuse).',
  ];
  if (dateSites.length > 0) {
    translate.push(
      `${dateSites.length} presentational date site(s) need a useFormatter rewrite — resolve the timeZone decision first (decisions[].timezone, REQUIRED).`,
    );
  }

  const wireToLocale = [
    pref
      ? `Mirror UI locale → cookie + \`router.refresh()\`, guarded by a cookie-difference check (avoid refresh loops). Model uiLanguage SEPARATELY from the existing \`${pref.symbol}\` content locale (decisions[].dual-locale).`
      : 'Mirror UI locale → cookie + `router.refresh()`, guarded by a cookie-difference check (avoid refresh loops; expect a one-render lag on fresh login).',
  ];
  if (decisions.some((d) => d.id === 'html-lang')) {
    wireToLocale.push('Update the root layout `<html lang="en">` → `lang={locale}` (async layout + `getLocale()`).');
  }

  const guard = [
    'Emit the recursive key-path parity test (catches BOTH missing AND extra keys across catalogs) — the highest-value reusable guard.',
    'Flip `react/jsx-no-literals` to error per FULLY-extracted file (it is noisy on partially-extracted files); never project-wide upfront.',
  ];
  for (const d of dynamicRoutes) {
    guard.push(
      `Glob the dynamic-route guard for \`${d.file}\` as \`${globSafe(d.file)}\` (not the literal \`[param]\`, which never matches) and self-verify via \`eslint --print-config\`.`,
    );
  }

  return [
    { phase: 'extract', items: extract },
    { phase: 'wire', items: wire },
    { phase: 'translate', items: translate },
    { phase: 'wire-to-locale', items: wireToLocale },
    { phase: 'guard', items: guard },
  ];
}

// ---------------------------------------------------------------------------
// top-level audit — assemble gotchas + decisions + readiness + phasedPlan.
// `inventory` is the M2 scan output. `appRoot` is optional but enables the
// firebase-admin SSR rule (the only source-dependent check); without it that
// rule is skipped (and reported as skipped via summary, not as a false negative).
// ---------------------------------------------------------------------------

export function audit(inventory, appRoot) {
  const inv = inventory;

  // FAIL LOUD (M8 hardening). audit is only as good as the inventory it reads. A
  // missing, malformed, or EMPTY inventory previously slipped through and emitted
  // a report carrying only the always-on app-level RTL info gotcha — a vacuous
  // "clean" surface that hides the fact nothing was scanned. Refuse it: throw a
  // clear error so the caller (CLI → non-zero exit; SKILL → abort + friction-log)
  // stops instead of trusting a hollow report.
  if (inv == null || typeof inv !== 'object') {
    throw new Error('audit: inventory is missing or not an object — run scan first to produce inventory.json.');
  }
  if (!Array.isArray(inv.sites) || !Array.isArray(inv.componentsByDensity)) {
    throw new Error(
      'audit: inventory is malformed (missing sites[] / componentsByDensity[]) — re-run scan to regenerate it.',
    );
  }
  if (inv.sites.length === 0 && inv.componentsByDensity.length === 0) {
    throw new Error(
      'audit: inventory is EMPTY (zero string sites and zero files with localizable work). ' +
        'Nothing to audit — re-run scan against the correct app root.',
    );
  }

  const firebaseGotchas = firebaseAdminGotchas(inv, appRoot);
  const structural = structuralIntlGotchas(inv);
  const timezone = timezoneGotchas(inv);
  const rtl = rtlGotchas();
  const dynamicRoute = dynamicRouteGotchas(inv);

  const gotchas = [...firebaseGotchas, ...structural, ...timezone, ...rtl, ...dynamicRoute];
  // stable sort: blockers first, then by type, then by file/line.
  const SEV_RANK = { block: 0, warn: 1, info: 2 };
  gotchas.sort((a, b) => {
    if (SEV_RANK[a.severity] !== SEV_RANK[b.severity]) return SEV_RANK[a.severity] - SEV_RANK[b.severity];
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    const af = a.file || '';
    const bf = b.file || '';
    return af.localeCompare(bf) || a.line - b.line;
  });

  const decisions = buildDecisions(inv);

  const firebaseBlockedFiles = new Set(firebaseGotchas.map((g) => g.file));
  const dynamicRouteFiles = new Set(dynamicRoute.map((g) => g.file));
  const readiness = buildReadiness(inv, firebaseBlockedFiles, dynamicRouteFiles);

  const phasedPlan = buildPhasedPlan(inv, gotchas, decisions);

  const summary = {
    totalGotchas: gotchas.length,
    blockers: gotchas.filter((g) => g.severity === 'block').length,
    warnings: gotchas.filter((g) => g.severity === 'warn').length,
    infos: gotchas.filter((g) => g.severity === 'info').length,
    filesReady: readiness.filter((r) => r.status === 'ready').length,
    filesBlocked: readiness.filter((r) => r.status === 'blocked').length,
    requiredDecisions: decisions.filter((d) => d.required).length,
  };

  return {
    schemaVersion: 1,
    gotchas,
    decisions,
    readiness,
    phasedPlan,
    summary,
  };
}

export default audit;
