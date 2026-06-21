// vibe-lingual engine — six-block brief assembly (M2).
//
// Pure function: inventory (scan output, with detection folded in) → a markdown
// brief mirroring the cowpath process-notes template (docs/inputs/cowpath-seed.md
// blocks 1-6). No I/O here — the CLI/SKILL owns writing it to disk.
//
//   Block 1 — Framework & i18n detection
//   Block 2 — Surface inventory
//   Block 3 — String-source audit (counts by kind)
//   Block 4 — Existing-localization map
//   Block 5 — Gap + phased plan
//   Block 6 — Stack-specific gotchas
//
// The brief is narrative-but-grounded: every number comes from the inventory,
// every gotcha is named with the file that triggers it. It is the human-readable
// face of inventory.json + the audit-to-come.

const KIND_LABEL = {
  'jsx-text': 'JSX text',
  placeholder: 'placeholder',
  'aria-label': 'aria-label',
  title: 'title',
  alt: 'alt',
  toast: 'toast / error',
  'date-intl': 'locale-sensitive date',
};

function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function includedSites(inv) {
  return inv.sites.filter((s) => !s.excluded);
}

function excludedSites(inv) {
  return inv.sites.filter((s) => s.excluded);
}

function block1(inv) {
  const a = inv.app;
  const lines = ['## 1. Framework & i18n detection', ''];
  lines.push(`- **Router type:** ${a.routerType}`);
  lines.push(`- **i18n framework:** ${a.framework}${a.framework === 'none' ? ' (no i18n library installed yet)' : ''}`);
  lines.push(`- **Turbopack:** ${a.turbopack ? 'yes' : 'no'}`);
  lines.push(`- **SSR surfaces:** ${a.ssrFiles.length} page/layout file(s)${a.ssrFiles.length ? ' — locale-loader mount points' : ''}`);
  if (a.ssrFiles.length) {
    for (const f of a.ssrFiles.slice(0, 8)) lines.push(`  - \`${f}\``);
    if (a.ssrFiles.length > 8) lines.push(`  - …and ${a.ssrFiles.length - 8} more`);
  }
  lines.push('');
  if (a.framework === 'none' && a.routerType === 'app') {
    lines.push(
      '> Recommended fit: **next-intl without i18n routing** (cookie-driven locale) when locale is a stored user preference, not a URL concern. URL `/[locale]/` routing fights auth redirects and existing share links.',
    );
    lines.push('');
  }
  return lines.join('\n');
}

function block2(inv) {
  const included = includedSites(inv);
  // Files-with-localizable-work — the count of files that hold at least one
  // INCLUDED site. This is `componentsByDensity.length` by construction (density
  // ranks included sites only), so the brief, the CLI stderr summary, and the
  // SKILL banner all report the SAME number. The eight Celestia3 files whose only
  // sites are excluded structural-Intl (tz math, date-key logic) carry no
  // localization work and must NOT inflate this count — they are reported as the
  // structural-excluded callouts in Block 3, not here.
  const filesWithLocalizableWork = inv.componentsByDensity.length;
  const filesWithAnySite = new Set(inv.sites.map((s) => s.file)).size;
  const structuralOnlyFiles = filesWithAnySite - filesWithLocalizableWork;
  const lines = ['## 2. Surface inventory', ''];
  lines.push(`- **Files with localizable strings:** ${filesWithLocalizableWork}`);
  if (structuralOnlyFiles > 0) {
    lines.push(
      `  - (${filesWithAnySite} files carry at least one string site; ${structuralOnlyFiles} hold only structural \`Intl\` sites — date-key / tz math, no localization work. See Block 3.)`,
    );
  }
  lines.push(`- **Total string sites (included):** ${included.length}`);
  lines.push('');
  lines.push('Top components by string density (localization work concentrates here):');
  lines.push('');
  const top = inv.componentsByDensity.slice(0, 12);
  if (top.length === 0) {
    lines.push('- _(none — no extractable strings found)_');
  } else {
    lines.push('| Component | Included sites |');
    lines.push('|---|---|');
    for (const c of top) lines.push(`| \`${c.file}\` | ${c.count} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function block3(inv) {
  const lines = ['## 3. String-source audit (counts by kind)', ''];
  lines.push('| Kind | Count |');
  lines.push('|---|---|');
  for (const k of Object.keys(inv.countsByKind)) {
    lines.push(`| ${KIND_LABEL[k] || k} | ${inv.countsByKind[k]} |`);
  }
  const total = Object.values(inv.countsByKind).reduce((a, b) => a + b, 0);
  lines.push(`| **Total** | **${total}** |`);
  lines.push('');
  const excluded = excludedSites(inv);
  if (excluded.length) {
    lines.push(
      `> **${excluded.length} structural \`Intl\` site(s) flagged EXCLUDED** — tz-offset math / locale-invariant parsing, NOT display copy. Extracting these corrupts logic; they are not part of the localization surface.`,
    );
    for (const s of excluded.slice(0, 8)) {
      lines.push(`>   - \`${s.file}:${s.line}\` — ${s.excludedReason || 'structural Intl'}`);
    }
    lines.push('');
  }
  lines.push(
    '> Scanner owns attribute-literal detection (placeholder / aria-label / title / alt); ESLint `jsx-no-literals` is too noisy on attributes and is reserved for JSX **text** only.',
  );
  lines.push('');
  return lines.join('\n');
}

function block4(inv) {
  const e = inv.existingI18n;
  const lines = ['## 4. Existing-localization map', ''];
  if (!e.lib && !e.languageList && !e.localePref) {
    lines.push('- No existing i18n machinery detected. The UI chrome is unlocalized.');
    lines.push('');
    return lines.join('\n');
  }
  lines.push(`- **i18n library:** ${e.lib || 'none'}`);
  if (e.languageList) {
    lines.push(`- **Existing language list:** \`${e.languageList.symbol}\` in \`${e.languageList.file}\` — reuse this for the UI locale picker; do NOT generate a parallel list.`);
  } else {
    lines.push('- **Existing language list:** none found.');
  }
  if (e.localePref) {
    lines.push(`- **Locale preference:** \`${e.localePref.symbol}\` in \`${e.localePref.file}\`.`);
    lines.push('- **Dual-locale check:** if this controls AI/content output, model UI locale (`uiLanguage`) SEPARATELY from content locale — they do not move in lockstep.');
  } else {
    lines.push('- **Locale preference:** none found.');
  }
  lines.push('');
  return lines.join('\n');
}

function block5(inv) {
  const included = includedSites(inv);
  const lines = ['## 5. Gap + phased plan', ''];
  lines.push('Arc: **extract → wire framework → translate → wire-to-locale → guard.**');
  lines.push('');
  lines.push(`- **Extract:** ${included.length} string site(s) across ${inv.componentsByDensity.length} file(s), ratcheting one fully-extracted file at a time.`);
  lines.push('- **Wire framework:** request config with an `AVAILABLE`-list guard + try/catch `en` fallback (a selected-but-missing catalog must never crash the request); locale cookie; provider mount; jest `transformIgnorePatterns` patch (i18n libs are ESM-only).');
  lines.push('- **Translate:** generate catalogs for the target locales; reuse the existing language list when present.');
  lines.push('- **Wire-to-locale:** mirror the locale preference → cookie + `router.refresh()`, guarded by a cookie-difference check (avoids refresh loops; expect a one-render lag on fresh login).');
  lines.push('- **Guard:** emit a recursive key-path parity test (catches missing AND extra keys); flip `react/jsx-no-literals` to error per fully-extracted file.');
  lines.push('');
  return lines.join('\n');
}

function block6(inv) {
  const a = inv.app;
  const lines = ['## 6. Stack-specific gotchas', ''];
  lines.push('- **firebase-admin banned in Turbopack SSR** — safe only in `functions/`. Screen App Router `page.tsx`/`layout.tsx` for firebase-admin imports before mounting a locale loader there.');
  lines.push('- **Timezone decision (surfaced, not auto-resolved):** do NOT set a global fixed `timeZone`. Client-rendered local dates want the browser zone (a fixed tz shifts dates a day for distant users); SSR-rendered dates DO need an explicit tz. Tests pin `timeZone="UTC"` for determinism only.');
  lines.push('- **RTL surface:** layout assumes LTR. Flag before adding Arabic / Hebrew / Urdu.');
  lines.push('- **Jest/ESM:** `next/jest` does not auto-transform next-intl 4.x (ESM-only). The wiring must inject `next-intl|use-intl|intl-messageformat|@formatjs` into `transformIgnorePatterns` or the existing suite breaks.');
  const dynamicRoutes = a.ssrFiles.filter((f) => /\[[^/]+\]/.test(f));
  if (dynamicRoutes.length) {
    lines.push(`- **Dynamic-route ESLint glob:** ${dynamicRoutes.length} dynamic-route file(s) (e.g. \`${dynamicRoutes[0]}\`). ESLint flat-config treats \`[param]\` as a minimatch char class — it SILENTLY never matches. The guard must glob the segment with \`*\` (e.g. \`s/*/page.tsx\`) and verify via \`eslint --print-config\`.`);
  }
  lines.push('- **Anonymous SSR viewers** (share links) have no pref cookie → default to source locale; the `AVAILABLE`-list guard covers this (`en` catalog generated first).');
  lines.push('- **`<html lang="en">`** in the root layout should become `lang={locale}` (async layout + `getLocale()`).');
  lines.push('');
  return lines.join('\n');
}

export function brief(inventory, opts = {}) {
  const inv = inventory;
  const date = opts.date || isoDate();
  const root = inv.app && inv.app.root ? inv.app.root : '(unknown root)';
  const filesScanned = inv._meta ? inv._meta.filesScanned : undefined;
  const parseErrors = inv._meta ? inv._meta.parseErrors : 0;

  const header = [
    `# i18n scan brief — ${root}`,
    '',
    `_Generated ${date} by vibe-lingual scan. Read-only inventory — no source was mutated._`,
    '',
    filesScanned != null
      ? `Scanned ${filesScanned} source file(s)${parseErrors ? `, ${parseErrors} skipped on parse error` : ''}.`
      : '',
    '',
  ].join('\n');

  return [
    header,
    block1(inv),
    block2(inv),
    block3(inv),
    block4(inv),
    block5(inv),
    block6(inv),
  ].join('\n');
}

export default brief;
