# WPF stack support — read-only first (detect + scan + brief; the adapter stands down honestly)

> Dated addendum to `spec.md`, per the banner-correct-don't-rewrite convention. Motivated by
> the first cross-stack dogfood: RoRoRo (`ROROROblox`, a WPF/.NET desktop app with 395 XAML
> string literals) ran v0.1.0 on 2026-09-05 — `detect` said `framework: "none"`, `scan`
> inventoried **0 sites** (the scanner is Babel/JSX-bound and cannot see XAML at all), and
> `wire` stood down per KTD-3. The stand-down was honest; the blindness was total. This
> change makes the READ side real for WPF and keeps the MUTATING side a declared stub.

## KTD-6 — the WPF gap is wider than the adapter seam; close the read side first

The adapter contract covers `wire`/`transform`/`emitParityTest`/`emitGuard` — the mutating
half. But `detect` (package.json-only) and `scan` (Babel AST over JS/TS) are also
JS-ecosystem-bound, so a WPF app was invisible before any adapter method could matter. v0.2
ships, in order of value:

1. **Detect arm** — recognize the stack (`app.stack: 'wpf'`) from `.csproj` markers.
2. **XAML scanner** — a real inventory of user-facing strings by kind, feeding the same
   six-block brief.
3. **`wpf-resx` stub** — the registry names the stack and `wire` stands down saying so.
4. **`audit`/`extract` stand down** for `stack: 'wpf'` with a clear message — their gotcha
   list and codemod are Next-specific; running them would emit confident noise (the M8
   fail-loud principle applied to a stack, not a file).

The mutating `wpf-resx` adapter (resx wiring, XAML codemod, resx parity, fence-style guard)
is a later change behind the same seam. Until then vibe-lingual sees a WPF app, counts its
real surface, and refuses to touch it — the KTD-3 promise, now with eyes.

## Detection (additive, JS path byte-identical)

`app.stack` joins the detection: `'js'` for everything detected today, `'wpf'` when the JS
probes find nothing (`framework: 'none'`, `routerType: 'unknown'`) AND a `.csproj` under the
root carries `<UseWPF>true</UseWPF>` or a `-windows` TargetFramework. A WPF detection adds
`app.wpf = { csprojFiles, xamlFileCount, resxFiles }` and maps `existingI18n.lib` to
`'resx'` when any non-designer `.resx` exists (`languageList`/`localePref` stay null — those
concepts have no WPF analog to detect lexically). The schema gains the optional `stack` +
`wpf` fields; `schemaVersion` stays 1 because every existing inventory still validates.

## The XAML scanner (KTD-4 applied to a new markup language)

`scan-xaml.mjs`, dispatched from `scan()` on `app.stack === 'wpf'`. A small hand-rolled
XAML tokenizer (elements, attributes, text nodes, comments, CDATA, entities) — no new
dependency, mirroring the engine's dependency-light stance; XML is regular enough that this
is honest where regex-over-JSX was not.

Classification is a **whitelist of display properties**, never a blacklist (the KTD-4
lesson: the scanner owns attribute detection):

| XAML surface | kind |
|---|---|
| element text; `Text`, `Content`, `Header`, `Title`, `Caption`, `Description` attrs; `Setter Property="<display>" Value="…"`; property-element syntax (`<Button.Content>…`) | `xaml-text` (new kind) |
| `ToolTip`, `ToolTipService.ToolTip` | `title` (same semantic: a tooltip) |
| `PlaceholderText`, `Watermark` | `placeholder` |
| `AutomationProperties.Name`, `AutomationProperties.HelpText` | `aria-label` (same semantic: the accessible name) |

Reusing three existing kinds keeps `countsByKind`, the brief, and downstream consumers
coherent; `xaml-text` is the one honest addition (calling XAML text "jsx-text" would be a
lie in the inventory). Structural exclusions are built into what the scanner refuses to
see: markup-extension values (`{Binding …}`, `{DynamicResource …}` — machinery, no copy;
the `{}` escape prefix marks a literal and is stripped), generated `*.g.xaml`, `bin/`/`obj/`,
and the shared text gates (letters required, identifier/CSS-token shapes rejected, the
short-fragment floor extended to `xaml-text`). The shared gates move to
`text-heuristics.mjs` so both scanners import one implementation — no circular import, no
divergence.

## What done looks like

The wpf-app fixture scans to a stable expected inventory (bindings skipped, escapes
stripped, Setter display-props caught, noise attrs silent); the full jest suite stays
green; and the RoRoRo dogfood run produces a real brief where v0.1.0 produced zeros — the
number lands near the hand-measured 395, and the delta is explainable (the measurement
counted literals; the scanner gates machinery out).
