// next-intl adapter — wire() (M6).
//
// Emits the framework WIRING file SET for a target App-Router app, modeled
// BYTE-FOR-BYTE on the proven Celestia3 cowpath (src/i18n/request.ts,
// src/i18n/locale-cookie.ts, the layout NextIntlClientProvider mount, the
// next.config createNextIntlPlugin wiring, and the jest transformIgnorePatterns
// ESM allowlist). Pure plan — wire() never writes; it returns a WiredFileSet the
// SKILL writes per confidence routing.
//
// What the cowpath proved (docs/inputs/cowpath-seed.md), encoded here:
//   - request.ts gates locale resolution on an AVAILABLE list of catalogs that
//     ACTUALLY EXIST, AND wraps the dynamic import in try/catch falling back to
//     the source locale. A selected-but-missing catalog never crashes the request.
//   - locale-cookie.ts is the single source of truth for the UI-locale cookie name
//     (request.ts reads it, the settings client writes it). No magic-string drift.
//   - the root layout mounts <NextIntlClientProvider> with NO props (locale +
//     messages resolve from request.ts via the plugin wiring).
//   - next.config wires createNextIntlPlugin with the EXPLICIT './src/i18n/request.ts'
//     path (request config under src/).
//   - jest.config's transformIgnorePatterns gets next-intl|use-intl|
//     intl-messageformat|@formatjs injected — i18n libs are ESM-only and break the
//     existing suite on first run otherwise.
//   - REUSE a detected language list (SUPPORTED_LANGUAGES) for the UI locale set
//     rather than generating a parallel world, and model UI locale (uiLanguage)
//     SEPARATELY from any output/content locale (outputLanguage) — they do not move
//     in lockstep (one picker controls AI generation, the other controls chrome).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, 'templates');

function tpl(name) {
  return readFileSync(join(TEMPLATE_DIR, name), 'utf8');
}

// The ESM allowlist injected into transformIgnorePatterns (the load-bearing fix).
// Each name ships ESM-only; SWC must transform them or the existing jest suite
// breaks the moment a component imports a next-intl hook.
export const ESM_ALLOWLIST = ['next-intl', 'use-intl', 'intl-messageformat', '@formatjs'];

// Default locale set when an app carries no detectable language list. The source
// locale is always first and always available (its catalog is generated first,
// covering the anonymous-SSR-viewer case from the cowpath).
const DEFAULT_LOCALES = ['en'];
const DEFAULT_SOURCE_LOCALE = 'en';
const DEFAULT_COOKIE_NAME = 'NEXT_LOCALE';

// ---------------------------------------------------------------------------
// locale-set resolution — REUSE what the app already has.
//   1. explicit ctx.locales (caller override) wins.
//   2. an existing language list (SUPPORTED_LANGUAGES) detected by M1 → reuse it
//      as the UI locale set (the cowpath lesson: don't generate a parallel list).
//   3. the existingI18n.languageList symbol on the detection, same source.
//   4. fall back to [sourceLocale].
// The source locale is forced to the front and de-duplicated so request.ts's
// AVAILABLE always leads with the always-generated source catalog.
// ---------------------------------------------------------------------------

function resolveLocales(ctx) {
  const sourceLocale = ctx.sourceLocale || DEFAULT_SOURCE_LOCALE;

  let locales = null;
  let reusedFrom = null;

  if (Array.isArray(ctx.locales) && ctx.locales.length > 0) {
    locales = ctx.locales.slice();
  } else if (ctx.existingLanguageList && Array.isArray(ctx.existingLanguageList.codes)) {
    locales = ctx.existingLanguageList.codes.slice();
    reusedFrom = ctx.existingLanguageList;
  } else if (
    ctx.detection &&
    ctx.detection.existingI18n &&
    ctx.detection.existingI18n.languageList &&
    Array.isArray(ctx.detection.existingI18n.languageList.codes)
  ) {
    locales = ctx.detection.existingI18n.languageList.codes.slice();
    reusedFrom = ctx.detection.existingI18n.languageList;
  }

  if (!locales || locales.length === 0) {
    locales = DEFAULT_LOCALES.slice();
  }

  // source locale first, de-duplicated, order-stable for the rest.
  const ordered = [sourceLocale, ...locales.filter((c) => c !== sourceLocale)];
  const seen = new Set();
  const deduped = ordered.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  return { locales: deduped, sourceLocale, reusedFrom };
}

// Emit the request.ts contents with the AVAILABLE list + try/catch en-fallback.
// AVAILABLE is rendered as a real JS array literal of the resolved locale set.
function renderRequest(locales, sourceLocale, messagesRel) {
  const availableLiteral =
    '[' + locales.map((c) => `'${c}'`).join(', ') + ']';
  return tpl('request.ts.template')
    .split('__AVAILABLE__').join(availableLiteral)
    .split('__SOURCE_LOCALE__').join(sourceLocale)
    .split('__MESSAGES_REL__').join(messagesRel);
}

function renderLocaleCookie(cookieName) {
  return tpl('locale-cookie.ts.template').split('__COOKIE_NAME__').join(cookieName);
}

function renderNextConfigPlugin(requestPath) {
  return tpl('next.config.plugin.template').split('__REQUEST_PATH__').join(requestPath);
}

// ---------------------------------------------------------------------------
// wire(ctx) → WiredFileSet { files, patches, notes }.
//   files   — new files to create (request.ts, locale-cookie.ts).
//   patches — edits to existing config: the layout provider mount, the next.config
//             plugin wiring, the jest transformIgnorePatterns ESM allowlist.
//   notes   — human-facing wiring notes (the one-render cookie lag, dual-locale
//             separation, the AVAILABLE-grows-with-catalogs contract).
// Pure: no I/O beyond reading the bundled templates, no mutation of the target.
// ---------------------------------------------------------------------------

export function wire(ctx = {}) {
  const detection = ctx.detection || {};
  const app = detection.app || {};

  // src-dir convention: the cowpath app keeps i18n under src/. Honor a detected
  // src/ layout (ssrFiles under src/, or an explicit ctx.srcDir); otherwise root.
  const usesSrcDir =
    ctx.srcDir === true ||
    (Array.isArray(app.ssrFiles) && app.ssrFiles.some((f) => f.startsWith('src/'))) ||
    false;
  // baseDir prefix: 'src/' under the src-dir convention, '' at the repo root —
  // never a './' segment (it would leak into the emitted file paths).
  const basePrefix = usesSrcDir ? 'src/' : '';

  const i18nDir = `${basePrefix}i18n`;
  const requestFilePath = `${i18nDir}/request.ts`;
  const cookieFilePath = `${i18nDir}/locale-cookie.ts`;

  // request.ts imports catalogs relative to itself (src/i18n → ../../messages on
  // the cowpath; one fewer ../ when i18n sits at the repo root).
  const messagesRel = usesSrcDir ? '../../messages' : '../messages';
  // the next.config plugin path is repo-root-relative with the leading ./.
  const requestPluginPath = `./${requestFilePath}`;

  const cookieName = ctx.cookieName || DEFAULT_COOKIE_NAME;
  const { locales, sourceLocale, reusedFrom } = resolveLocales(ctx);

  // the layout file to mount the provider in — detected root layout, else the
  // src/ convention default.
  const layoutFile =
    (Array.isArray(app.ssrFiles) &&
      app.ssrFiles.find((f) => /(^|\/)layout\.(tsx|jsx|ts|js)$/.test(f) && f.split('/').length <= 3)) ||
    (usesSrcDir ? 'src/app/layout.tsx' : 'app/layout.tsx');

  // the jest config to patch — detected, else the conventional root file.
  const jestConfigFile = ctx.jestConfigFile || 'jest.config.js';
  // the next.config to patch — detected, else the conventional root file.
  const nextConfigFile = ctx.nextConfigFile || 'next.config.ts';

  const files = [
    { path: requestFilePath, contents: renderRequest(locales, sourceLocale, messagesRel) },
    { path: cookieFilePath, contents: renderLocaleCookie(cookieName) },
  ];

  const patches = [
    {
      file: layoutFile,
      kind: 'next-intl-provider-mount',
      description:
        'Wrap the root layout <body> children in <NextIntlClientProvider> (no props — ' +
        'locale + messages resolve from ' + requestFilePath + ' via the plugin wiring). ' +
        'Add `import { NextIntlClientProvider } from "next-intl";`.',
      snippet: tpl('provider-mount.snippet.template'),
    },
    {
      file: nextConfigFile,
      kind: 'next-config-plugin',
      description:
        'Wire createNextIntlPlugin with the explicit "' + requestPluginPath + '" path and ' +
        'wrap the exported config: `export default withNextIntl(nextConfig);`.',
      snippet: renderNextConfigPlugin(requestPluginPath),
    },
    {
      file: jestConfigFile,
      kind: 'jest-transform-ignore',
      description:
        'Inject the ESM allowlist (' + ESM_ALLOWLIST.join('|') + ') into every node_modules ' +
        'transformIgnorePatterns entry via the async config wrapper — i18n libs are ESM-only ' +
        'and break the existing suite on first run otherwise.',
      allowlist: ESM_ALLOWLIST.slice(),
      snippet: tpl('jest-transform-ignore.snippet.template'),
    },
  ];

  const notes = [];

  // dual-locale modeling note — only when the app already controls an output
  // locale (the cowpath SUPPORTED_LANGUAGES + outputLanguage shape). UI locale
  // (uiLanguage / the cookie) is modeled SEPARATELY from the output locale.
  const localePref =
    detection.existingI18n && detection.existingI18n.localePref
      ? detection.existingI18n.localePref
      : null;
  if (localePref) {
    notes.push(
      `Dual-locale: this app already controls an output/content locale ` +
        `(\`${localePref.symbol}\` in ${localePref.file}). The wiring models the UI locale ` +
        `(\`${cookieName}\` cookie) SEPARATELY — one picker controls AI/output language, the ` +
        `other controls chrome. They do not move in lockstep.`,
    );
  }

  if (reusedFrom) {
    notes.push(
      `Reused the app's existing language list (\`${reusedFrom.symbol}\`` +
        (reusedFrom.file ? ` in ${reusedFrom.file}` : '') +
        `) for the UI locale set instead of generating a parallel list: ` +
        `[${locales.join(', ')}].`,
    );
  }

  notes.push(
    `One-render cookie lag (NOT a bug): the UI-locale cookie is set client-side, so the very ` +
      `first paint after a fresh login may render one frame in the source locale before the ` +
      `cookie-driven refresh lands. Subsequent navigations are correct.`,
  );
  notes.push(
    `AVAILABLE in ${requestFilePath} is advisory and grows as catalogs are generated — a ` +
      `selected-but-missing catalog falls back to '${sourceLocale}' via the try/catch, so a ` +
      `partial rollout never crashes the request (the anonymous-SSR-viewer case is covered: ` +
      `'${sourceLocale}' is always generated first).`,
  );

  return { files, patches, notes };
}

export default wire;
