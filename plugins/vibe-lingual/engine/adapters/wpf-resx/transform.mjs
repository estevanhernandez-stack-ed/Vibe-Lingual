// wpf-resx adapter — the XAML codemod.
//
// Rewrites user-facing string literals into {x:Static loc:Strings.Key} resource
// references, producing the resx entries alongside. The site list comes from the
// SAME tokenizer pass the scanner uses (scanXamlFileDetailed), spans included —
// the scanner and the codemod cannot disagree about what a site is.
//
// What is transformed automatically (high confidence):
//   - whitelist display ATTRIBUTES (Text/Content/Header/…, ToolTip,
//     PlaceholderText/Watermark, AutomationProperties.*), Setter Values for
//     display properties included. The raw value span (including a `{}` escape
//     prefix) is replaced with the x:Static reference.
//   - SOLE-CONTENT text nodes of elements with a known text property
//     (<TextBlock>hello</TextBlock> → <TextBlock Text="{x:Static …}" />), only
//     when the element does not already carry that attribute.
//
// What is STAGED for a human (honest per-site routing, never guessed):
//   - text nodes that are not sole content, or whose element has no known text
//     property, or property-element syntax (<Button.Content>…) — converting
//     these means restructuring markup, not swapping a span.
//
// Idempotent by construction: a transformed value starts with '{', which the
// scanner classifies as a markup extension and never re-inventories.
//
// The root element gains xmlns:loc="clr-namespace:<ns>" when any rewrite
// happened and the prefix is absent. Pure function — no I/O.

import { scanXamlFileDetailed } from '../../scan-xaml.mjs';

// element → the attribute its sole text content collapses into.
const TEXT_PROPERTY_BY_ELEMENT = {
  TextBlock: 'Text',
  Run: 'Text',
  TextBox: 'Text',
  Label: 'Content',
  Button: 'Content',
  CheckBox: 'Content',
  RadioButton: 'Content',
  ToggleButton: 'Content',
  GroupBox: 'Header',
  Expander: 'Header',
  TabItem: 'Header',
  MenuItem: 'Header',
};

// Insert xmlns:loc on the root element (after its first xmlns declaration, so
// the added attribute reads as part of the namespace block).
function ensureLocXmlns(text, prefix, clrNamespace) {
  if (new RegExp(`xmlns:${prefix}\\s*=`).test(text)) return text;
  const decl = `xmlns:${prefix}="clr-namespace:${clrNamespace}"`;
  const firstXmlns = text.match(/\n(\s*)xmlns(?::[\w]+)?\s*=\s*"[^"]*"/);
  if (firstXmlns) {
    const insertAt = firstXmlns.index + firstXmlns[0].length;
    return `${text.slice(0, insertAt)}\n${firstXmlns[1]}${decl}${text.slice(insertAt)}`;
  }
  // no newline-led xmlns (single-line root tag): insert after the root name.
  const root = text.match(/<[A-Za-z_][\w.:]*/);
  if (!root) return text;
  const at = root.index + root[0].length;
  return `${text.slice(0, at)} ${decl}${text.slice(at)}`;
}

// Transform ONE XAML document. options:
//   clrNamespace — the designer class's namespace (e.g. ROROROblox.App.Properties)
//   xmlnsPrefix  — default 'loc'
//   registry     — a shared KeyRegistry (one per run, so identical text shares keys)
//   resourceClass — default 'Strings'
// Returns { newText, entries, staged, changed }.
export function transformXamlSource(text, relPosix, options) {
  const { clrNamespace, registry } = options;
  const prefix = options.xmlnsPrefix || 'loc';
  const resourceClass = options.resourceClass || 'Strings';
  if (!clrNamespace || !registry) {
    throw new Error('wpf-resx transform: clrNamespace and registry are required');
  }

  const sites = scanXamlFileDetailed(relPosix, text);
  const entries = [];
  const staged = [];
  const edits = []; // { start, end, replacement }

  for (const site of sites) {
    const key = registry.keyFor(site.suggestedNamespace, site.suggestedKey, site.text);
    const ref = `{x:Static ${prefix}:${resourceClass}.${key}}`;

    if (site.siteType === 'attr') {
      edits.push({ start: site.span.start, end: site.span.end, replacement: ref });
      entries.push({ key, value: site.text, comment: `${site.file}:${site.line} ${site.kind}` });
      continue;
    }

    // text node — sole content of an element with a known text property, and
    // the element does not already carry that attribute → collapse.
    const sole = site.soleContent;
    const attr = sole ? TEXT_PROPERTY_BY_ELEMENT[sole.elementName] : null;
    if (sole && attr && !sole.openAttrNames.includes(attr)) {
      edits.push({
        start: sole.openTagGtIndex,
        end: sole.closeEndIndex,
        replacement: ` ${attr}="${ref}" />`,
      });
      entries.push({ key, value: site.text, comment: `${site.file}:${site.line} ${site.kind}` });
      continue;
    }

    staged.push({
      file: site.file,
      line: site.line,
      kind: site.kind,
      text: site.text,
      suggestedKey: key,
      reason: sole
        ? attr
          ? `element <${sole.elementName}> already sets ${attr}`
          : `no known text property for <${sole.elementName}>`
        : site.enclosingElement && site.enclosingElement.includes('.')
          ? `property-element syntax (<${site.enclosingElement}>) needs hand conversion`
          : 'text node is not the sole content of its element',
    });
  }

  if (edits.length === 0) {
    return { newText: text, entries: [], staged, changed: false };
  }

  // Apply edits back-to-front so earlier spans stay valid.
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) {
    out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  }
  out = ensureLocXmlns(out, prefix, clrNamespace);

  return { newText: out, entries, staged, changed: true };
}

export default transformXamlSource;
