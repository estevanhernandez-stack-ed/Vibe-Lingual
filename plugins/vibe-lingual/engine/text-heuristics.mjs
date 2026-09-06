// vibe-lingual engine — shared user-facing-text heuristics.
//
// Extracted from scan.mjs (2026-09-05, WPF stack change) so the JSX scanner and the
// XAML scanner classify copy with ONE implementation instead of two drifting ones.
// Pure functions, no I/O. Behavior is byte-identical to the pre-extraction scan.mjs;
// the only addition is the `xaml-text` kind joining `jsx-text` under the
// short-fragment floor (a one-token <=2-char XAML text node is the same inline-split
// noise a JSX one is).

// A string that is plausibly user-facing copy: has at least one letter, contains
// a word a human reads. Rejects pure punctuation/whitespace/numbers/symbols.
export function hasLetter(s) {
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

export function isCssClassString(s) {
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
export function isIdentifierShaped(s) {
  const t = s.trim();
  if (/\s/.test(t)) return false; // has a space → could be a phrase
  if (/^[A-Z0-9_]+$/.test(t) && t.length > 2) return true; // ALL_CAPS_CONST
  if (/[._/]/.test(t) && !/[.!?]$/.test(t)) return true; // dotted/path/snake id
  if (/^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(t)) return true; // camelCase
  return false;
}

// Final gate for whether a candidate string is user-facing copy worth a site.
// `kind` lets the gate apply a kind-specific floor: a text node that is a single
// token of <=2 chars is below the floor for a standalone translation key — it is
// almost always a sentence fragment split by an inline element or a unit suffix.
// The floor applies to the free-text kinds (jsx-text, xaml-text), NOT to
// attribute kinds (a `title="OK"` / `alt="ID"` is legitimately short).
export function isUserFacingText(s, kind) {
  const t = s.trim();
  if (!t) return false;
  if (!hasLetter(t)) return false;
  if (isCssClassString(t)) return false;
  if (isIdentifierShaped(t)) return false;
  if (kind === 'jsx-text' || kind === 'xaml-text') {
    const tokens = t.split(/\s+/);
    if (tokens.length === 1 && t.length <= 2) return false;
  }
  return true;
}

// Key: a camelCase slug from the first words of the text.
export function suggestedKey(text) {
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

// Confidence: high for a clean short phrase, medium for long/variable-ish text,
// low for interpolated fragments and review-always kinds.
export function siteConfidence(kind, text) {
  const len = text.trim().length;
  if (kind === 'date-intl') return 'low'; // always needs human review
  if (kind === 'toast') return text.includes('${') || text.includes('{') ? 'low' : 'medium';
  if (len <= 60 && !/[{}]/.test(text)) return 'high';
  if (len <= 140) return 'medium';
  return 'low';
}
