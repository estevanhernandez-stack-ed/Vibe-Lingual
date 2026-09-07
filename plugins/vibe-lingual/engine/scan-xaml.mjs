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
// 2026-09-06 (wpf-resx adapter): the tokenizer now records SPANS. The detailed
// layer (`scanXamlFileDetailed`) returns each site with the exact byte range of
// its attribute value or text node — the wpf-resx transform rewrites through
// those spans, so the scanner and the codemod can never disagree about what a
// site is. `scanXaml` derives the schema-clean inventory from the same pass; the
// persisted shape is unchanged.
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

// Value-typed elements whose text content is a parsed VALUE, never copy — a
// <FontFamily> holds a font stack, a <Color> a hex triplet, a <Thickness> a
// margin. Letters and commas get them past the generic gates (the RoRoRo
// dogfood staged two brand font stacks), so they are excluded by name.
const VALUE_ELEMENTS = new Set([
  'FontFamily',
  'Color',
  'SolidColorBrush',
  'Thickness',
  'CornerRadius',
  'GridLength',
  'Duration',
  'Geometry',
  'PathGeometry',
]);

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
// the tokenizer — one forward pass, tracking line numbers, spans, and an
// element stack. Produces DETAILED sites; scanXaml strips them to the
// schema-clean inventory shape.
// ---------------------------------------------------------------------------

const ATTR_RE = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function scanXamlFileDetailed(relPosix, text) {
  const namespace = basename(relPosix).replace(/\.xaml$/i, '');
  const sites = [];
  const stack = []; // open element names (local name, xmlns prefix stripped)
  let i = 0;
  let line = 1;
  const n = text.length;

  // Tracks the most recently OPENED element so a text node can know whether it
  // is the element's sole content (open tag → text → matching close, nothing
  // between). Any other construct in between clears it.
  let lastOpen = null; // { name, gtIndex, contentStart, attrNames, pendingSite }

  const advance = (to) => {
    for (; i < to; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  };

  const makeSite = (kind, raw, atLine, extra) => {
    const value = decodeEntities(raw).trim();
    if (!isUserFacingText(value, kind)) return null;
    const site = {
      file: relPosix,
      line: atLine,
      kind,
      text: value,
      suggestedNamespace: namespace,
      suggestedKey: suggestedKey(value),
      confidence: siteConfidence(kind, value),
      structuralIntl: false,
      ...extra,
    };
    sites.push(site);
    return site;
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
      const textStart = i;
      if (raw.trim()) {
        // property-element syntax: text directly inside <X.Property> takes that
        // property's kind; otherwise any element text is xaml-text — unless the
        // enclosing element is a value type (font stacks, colors: not copy).
        const enclosing = stack.length ? stack[stack.length - 1] : null;
        if (enclosing && VALUE_ELEMENTS.has(enclosing)) {
          advance(lt);
          continue;
        }
        const propKind = enclosing && enclosing.includes('.') ? kindForProperty(enclosing) : null;
        const site = makeSite(propKind || 'xaml-text', raw, textLine, {
          siteType: 'text',
          span: { start: textStart, end: lt },
          enclosingElement: enclosing,
        });
        // Sole-content candidacy: the text starts exactly where the last opened
        // element's content starts. Confirmed when the very next construct is
        // that element's close tag.
        if (site && lastOpen && lastOpen.contentStart === textStart) {
          lastOpen.pendingSite = site;
        }
      } else if (lastOpen && lastOpen.contentStart === textStart) {
        // whitespace-only content keeps the candidacy window open for nothing —
        // there is no site to enrich; clear it.
        lastOpen = null;
      }
      advance(lt);
    }

    // ----- comment / CDATA / processing instruction / doctype -----
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      lastOpen = null;
      advance(end === -1 ? n : end + 3);
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i + 9);
      lastOpen = null;
      advance(end === -1 ? n : end + 3);
      continue;
    }
    if (text.startsWith('<?', i) || text.startsWith('<!', i)) {
      const end = text.indexOf('>', i);
      lastOpen = null;
      advance(end === -1 ? n : end + 1);
      continue;
    }

    // ----- closing tag -----
    if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i);
      const closeEnd = end === -1 ? n : end + 1;
      // Sole-content confirmation: this close immediately follows the candidate
      // text node of the element it closes.
      if (lastOpen && lastOpen.pendingSite && lastOpen.pendingSite.span.end === i) {
        lastOpen.pendingSite.soleContent = {
          elementName: lastOpen.name,
          openTagGtIndex: lastOpen.gtIndex,
          closeEndIndex: closeEnd,
          openAttrNames: lastOpen.attrNames,
        };
      }
      lastOpen = null;
      if (stack.length) stack.pop();
      advance(closeEnd);
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
    const tagStart = i;
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
      // Span of the raw value INSIDE its quotes, in whole-file coordinates:
      // am.index is the attr name's offset within `tag`; the value starts after
      // the opening quote of the quoted group.
      const quoted = am[2];
      const valueOffsetInMatch = am[0].length - quoted.length + 1; // past the opening quote
      const valueStart = tagStart + 1 + am.index + valueOffsetInMatch;
      const localAttr = attrName.includes(':') && !attrName.startsWith('AutomationProperties')
        ? attrName.slice(attrName.indexOf(':') + 1)
        : attrName;
      attrs.push({
        name: localAttr,
        rawName: attrName,
        value: attrValue,
        span: { start: valueStart, end: valueStart + attrValue.length },
      });
      if (localName === 'Setter' && localAttr === 'Property') setterProperty = attrValue;
    }

    for (const attr of attrs) {
      let kind = null;
      if (localName === 'Setter') {
        if (attr.name !== 'Value') continue;
        kind = kindForProperty(setterProperty);
      } else {
        kind = Object.prototype.hasOwnProperty.call(ATTR_KIND, attr.name) ? ATTR_KIND[attr.name] : null;
      }
      if (!kind) continue;
      const literal = literalAttrValue(attr.value);
      if (literal == null) continue; // {Binding …} and friends — machinery
      makeSite(kind, literal, tagLine, {
        siteType: 'attr',
        attrName: attr.rawName,
        elementName: localName,
        span: attr.span, // raw value incl. any '{}' escape prefix
        escaped: attr.value.startsWith('{}'),
      });
    }

    if (!selfClosing && localName) {
      stack.push(localName);
      lastOpen = {
        name: localName,
        gtIndex: j === n ? n - 1 : j,
        contentStart: j === n ? n : j + 1,
        attrNames: attrs.map((a) => a.name),
        pendingSite: null,
      };
    } else {
      lastOpen = null;
    }
    advance(j === n ? n : j + 1);
  }

  return sites;
}

// The schema-clean shape scanXaml persists: detailed span/structure fields
// stripped (the inventory schema is additionalProperties:false by design).
function scanXamlFile(relPosix, text, sites) {
  for (const s of scanXamlFileDetailed(relPosix, text)) {
    sites.push({
      file: s.file,
      line: s.line,
      kind: s.kind,
      text: s.text,
      suggestedNamespace: s.suggestedNamespace,
      suggestedKey: s.suggestedKey,
      confidence: s.confidence,
      structuralIntl: false,
    });
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
