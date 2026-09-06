// vibe-lingual engine — XAML string-site scan (WPF stack, 2026-09-05).
//
// Pure read. Walks a WPF app's .xaml files with a small hand-rolled tokenizer
// (elements, attributes, text nodes, comments, CDATA, entities — XML is regular
// enough that this is honest where regex-over-JSX was not) and emits user-facing
// string sites in the SAME inventory shape scan.mjs produces, so the brief and
// every downstream consumer read one format.
//
// Classification is a WHITELIST of display properties (the KTD-4 lesson applied
// to a new markup language — the scanner owns attribute detection, and a
// blacklist can never keep up with XAML's property space):
//   xaml-text   — element text; Text/Content/Header/Title/Caption/Description
//                 attrs; Setter Value for a display Property; property-element
//                 syntax (<Button.Content>…</Button.Content>)
//   title       — ToolTip / ToolTipService.ToolTip (same semantic as HTML title)
//   placeholder — PlaceholderText / Watermark
//   aria-label  — AutomationProperties.Name / .HelpText (the accessible name)
//
// Structural exclusions are what the scanner refuses to see at all:
//   - markup-extension values ({Binding …}, {DynamicResource …}, {x:Static …}) —
//     machinery, no copy. The XAML `{}` escape prefix marks a literal brace
//     string; it is stripped and the remainder treated as copy.
//   - generated *.g.xaml, bin/, obj/, and the usual non-source dirs.
//   - everything the shared text gates reject (no letters, identifier/CSS-token
//     shapes, the short-fragment floor for xaml-text).
//
// No mutation, no network. A file that fails to read is skipped; the tokenizer
// itself is forgiving (unclosed constructs consume to end-of-file, never throw).

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, sep, basename } from 'node:path';
import { isUserFacingText, suggestedKey, siteConfidence } from './text-heuristics.mjs';

// ---------------------------------------------------------------------------
// file discovery
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'bin', 'obj', 'dist', 'build', 'packages', '.vs', 'out']);
const GENERATED_XAML_RE = /\.g\.xaml$/i;

function toPosix(p) {
  return p.split(sep).join('/');
}

function walkXamlFiles(dir, root, acc) {
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
      walkXamlFiles(full, root, acc);
    } else if (entry.isFile() && /\.xaml$/i.test(entry.name) && !GENERATED_XAML_RE.test(entry.name)) {
      acc.push(full);
    }
  }
}

export function listXamlFiles(root) {
  const acc = [];
  if (existsSync(root)) {
    try {
      if (statSync(root).isDirectory()) walkXamlFiles(root, root, acc);
    } catch {
      /* unreadable root → empty inventory */
    }
  }
  return acc.sort();
}

// ---------------------------------------------------------------------------
// display-property whitelist → kind
// ---------------------------------------------------------------------------

const ATTR_KIND = {
  Text: 'xaml-text',
  Content: 'xaml-text',
  Header: 'xaml-text',
  Title: 'xaml-text',
  Caption: 'xaml-text',
  Description: 'xaml-text',
  ToolTip: 'title',
  'ToolTipService.ToolTip': 'title',
  PlaceholderText: 'placeholder',
  Watermark: 'placeholder',
  'AutomationProperties.Name': 'aria-label',
  'AutomationProperties.HelpText': 'aria-label',
};

// For property-element syntax (<Button.Content>text</…>) and Setter Property
// values: the property name (last dotted segment for property elements) looked
// up against the same whitelist.
function kindForProperty(propName) {
  if (!propName) return null;
  if (Object.prototype.hasOwnProperty.call(ATTR_KIND, propName)) return ATTR_KIND[propName];
  const last = propName.split('.').pop();
  return Object.prototype.hasOwnProperty.call(ATTR_KIND, last) ? ATTR_KIND[last] : null;
}

// A markup-extension value ({Binding …} etc.) carries no copy. The `{}` prefix
// is XAML's escape for a literal string starting with '{': strip it, keep the rest.
function literalAttrValue(raw) {
  if (raw.startsWith('{}')) return raw.slice(2);
  if (raw.startsWith('{')) return null; // markup extension — machinery
  return raw;
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return Object.prototype.hasOwnProperty.call(XML_ENTITIES, body) ? XML_ENTITIES[body] : m;
  });
}

// ---------------------------------------------------------------------------
// the tokenizer — one forward pass, tracking line numbers and an element stack.
// ---------------------------------------------------------------------------

const ATTR_RE = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function scanXamlFile(relPosix, text, sites) {
  const namespace = basename(relPosix).replace(/\.xaml$/i, '');
  const stack = []; // open element names (local name, xmlns prefix stripped)
  let i = 0;
  let line = 1;
  const n = text.length;

  const advance = (to) => {
    for (; i < to; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  };

  const pushSite = (kind, raw, atLine) => {
    const value = decodeEntities(raw).trim();
    if (!isUserFacingText(value, kind)) return;
    sites.push({
      file: relPosix,
      line: atLine,
      kind,
      text: value,
      suggestedNamespace: namespace,
      suggestedKey: suggestedKey(value),
      confidence: siteConfidence(kind, value),
      structuralIntl: false,
    });
  };

  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) {
      break; // trailing text outside any element is not display copy
    }

    // ----- text node between tags -----
    if (lt > i) {
      const raw = text.slice(i, lt);
      const textLine = line;
      if (raw.trim()) {
        // property-element syntax: text directly inside <X.Property> takes that
        // property's kind; otherwise any element text is xaml-text.
        const enclosing = stack.length ? stack[stack.length - 1] : null;
        const propKind = enclosing && enclosing.includes('.') ? kindForProperty(enclosing) : null;
        pushSite(propKind || 'xaml-text', raw, textLine);
      }
      advance(lt);
    }

    // ----- comment / CDATA / processing instruction / doctype -----
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      advance(end === -1 ? n : end + 3);
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      advance(end === -1 ? n : end + 3);
      continue;
    }
    if (text.startsWith('<?', i) || text.startsWith('<!', i)) {
      const end = text.indexOf('>', i);
      advance(end === -1 ? n : end + 1);
      continue;
    }

    // ----- closing tag -----
    if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i);
      if (stack.length) stack.pop();
      advance(end === -1 ? n : end + 1);
      continue;
    }

    // ----- element tag: consume to the matching '>' respecting quotes -----
    let j = i + 1;
    let quote = null;
    while (j < n) {
      const ch = text[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j += 1;
    }
    const tag = text.slice(i + 1, j); // without < >
    const tagLine = line;
    const selfClosing = /\/\s*$/.test(tag);
    const nameMatch = /^\s*([A-Za-z_][\w.:-]*)/.exec(tag);
    const rawName = nameMatch ? nameMatch[1] : '';
    const localName = rawName.includes(':') ? rawName.slice(rawName.indexOf(':') + 1) : rawName;

    // Setter is special: the display-ness lives in Property=, the copy in Value=.
    let setterProperty = null;
    const attrs = [];
    ATTR_RE.lastIndex = 0;
    let am;
    while ((am = ATTR_RE.exec(tag)) !== null) {
      const attrName = am[1];
      const attrValue = am[3] != null ? am[3] : am[4];
      const localAttr = attrName.includes(':') && !attrName.startsWith('AutomationProperties')
        ? attrName.slice(attrName.indexOf(':') + 1)
        : attrName;
      attrs.push({ name: localAttr, value: attrValue });
      if (localName === 'Setter' && localAttr === 'Property') setterProperty = attrValue;
    }

    for (const { name, value } of attrs) {
      let kind = null;
      if (localName === 'Setter') {
        if (name !== 'Value') continue;
        kind = kindForProperty(setterProperty);
      } else {
        kind = Object.prototype.hasOwnProperty.call(ATTR_KIND, name) ? ATTR_KIND[name] : null;
      }
      if (!kind) continue;
      const literal = literalAttrValue(value);
      if (literal == null) continue; // {Binding …} and friends — machinery
      pushSite(kind, literal, tagLine);
    }

    if (!selfClosing && localName) stack.push(localName);
    advance(j === n ? n : j + 1);
  }
}

// ---------------------------------------------------------------------------
// top-level — same inventory shape as scan.mjs, WPF kinds layered onto the JS
// kind keys (title/placeholder/aria-label are shared semantics; xaml-text is the
// one honest addition).
// ---------------------------------------------------------------------------

const JS_KINDS = ['jsx-text', 'placeholder', 'aria-label', 'title', 'alt', 'toast', 'date-intl'];

export function scanXaml(root, detection) {
  const files = listXamlFiles(root);
  const sites = [];
  let parseErrors = 0;

  for (const abs of files) {
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      parseErrors += 1;
      continue;
    }
    scanXamlFile(toPosix(relative(root, abs)), text, sites);
  }

  const countsByKind = Object.fromEntries(JS_KINDS.map((k) => [k, 0]));
  countsByKind['xaml-text'] = 0;
  for (const s of sites) {
    countsByKind[s.kind] = (countsByKind[s.kind] || 0) + 1;
  }

  const byFile = new Map();
  for (const s of sites) {
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

  Object.defineProperty(inventory, '_meta', {
    value: {
      filesScanned: files.length,
      parseErrors,
      ignoreSources: ['built-in wpf defaults (bin/obj/*.g.xaml)'],
      ignorePatternCount: SKIP_DIRS.size + 1,
    },
    enumerable: false,
    writable: false,
    configurable: true,
  });

  return inventory;
}

export default scanXaml;
