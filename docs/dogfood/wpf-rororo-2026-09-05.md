# WPF dogfood — RoRoRo (ROROROblox), 2026-09-05

> First cross-stack dogfood, same day the WPF read side was built. v0.1.0 scanned this app
> as **0 sites** (Babel/JSX-bound); this branch scans **530 sites across 30 XAML files**:
> 385 xaml-text + 81 automation names + 62 tooltips + 2 placeholders (423 high-confidence).
> The repo's own hand measurement was "395 hardcoded XAML string literals" — two independent
> methods landing within ten of each other on the text kind, while the scanner also sees the
> accessibility and tooltip surfaces a literal-count misses. `wire`/`audit`/`extract` stand
> down naming `wpf-resx`. The brief below is the scan's verbatim output.

---
# i18n scan brief — C:\Users\estev\Projects\ROROROblox

_Generated 2026-09-06 by vibe-lingual scan. Read-only inventory — no source was mutated._

Scanned 31 source file(s).

## 1. Framework & i18n detection

- **App stack:** WPF (.NET desktop)
- **WPF project(s):** 5
  - `src/ROROROblox.App/ROROROblox.App.csproj`
  - `src/ROROROblox.Core/ROROROblox.Core.csproj`
  - `src/ROROROblox.PluginTestHarness/ROROROblox.PluginTestHarness.csproj`
  - `src/ROROROblox.Tests/ROROROblox.Tests.csproj`
  - `tools/CompatSigner/CompatSigner.csproj`
- **XAML surface:** 31 file(s) (generated `*.g.xaml` excluded)
- **Existing localization:** none — no .resx resources; the UI chrome is unlocalized

> The mutating loop (extract → wire → translate → guard) is **not yet implemented** for WPF — this scan is the read-only inventory. The `wpf-resx` adapter is a declared stub; `localize`/`wire` will stand down honestly.

## 2. Surface inventory

- **Files with localizable strings:** 30
- **Total string sites (included):** 530

Top components by string density (localization work concentrates here):

| Component | Included sites |
|---|---|
| `src/ROROROblox.App/Preferences/SettingsPage.xaml` | 172 |
| `src/ROROROblox.App/MainWindow.xaml` | 121 |
| `src/ROROROblox.App/Games/GamesPage.xaml` | 30 |
| `src/ROROROblox.App/About/WelcomeWindow.xaml` | 27 |
| `src/ROROROblox.App/About/AboutPage.xaml` | 14 |
| `src/ROROROblox.App/Modals/RobloxAlreadyRunningWindow.xaml` | 12 |
| `src/ROROROblox.App/Plugins/PluginsPage.xaml` | 12 |
| `src/ROROROblox.App/SquadLaunch/SquadLaunchWindow.xaml` | 11 |
| `src/ROROROblox.App/CookieCapture/CookieCaptureWindow.xaml` | 10 |
| `src/ROROROblox.App/Theming/ThemeBuilderWindow.xaml` | 10 |
| `src/ROROROblox.App/Transport/ExportAccountsWindow.xaml` | 10 |
| `src/ROROROblox.App/Transport/ImportAccountsWindow.xaml` | 9 |

## 3. String-source audit (counts by kind)

| Kind | Count |
|---|---|
| placeholder | 2 |
| aria-label / automation name | 81 |
| title / tooltip | 62 |
| XAML text | 385 |
| **Total** | **530** |

> Scanner owns display-attribute detection via a WHITELIST of display properties (Text/Content/Header/ToolTip/PlaceholderText/AutomationProperties.\*, Setter values included). Markup-extension values (`{Binding …}`, `{DynamicResource …}`) are machinery and are never inventoried; the `{}` escape prefix marks a literal.

## 4. Existing-localization map

- No existing i18n machinery detected. The UI chrome is unlocalized.

## 5. Gap + phased plan

Arc: **extract → wire culture → translate → guard** — pending the `wpf-resx` adapter (not yet implemented; this brief is the read side).

- **Extract:** 530 string site(s) across 30 XAML file(s) → `.resx` resources referenced from XAML, one fully-extracted file at a time.
- **Wire culture:** per-locale satellite `.resx` files + a `CultureInfo` selection point; the package manifest declares a language ONLY when the UI genuinely ships it.
- **Translate:** generate the per-culture resx catalogs.
- **Guard:** a resx key-parity test across cultures (missing AND extra keys), plus a source-level fence banning new hardcoded display literals per extracted file.

## 6. Stack-specific gotchas

- **Declared languages must not outrun the UI.** A package manifest `<Resource Language>` entry is a Store-facing claim; adding one before the UI genuinely ships that language is a lie. Listing-language translation needs no code and no manifest change.
- **Code-composed strings cannot be extracted from XAML.** Strings built in C# (result messages, status lines) need a key+data boundary so the view layer owns the sentence — audit where prose is composed before sweeping the markup.
- **Bindings and markup extensions carry no copy** — but a `StringFormat` inside one can (`{Binding Count, StringFormat=…}`). This scanner excludes ALL markup-extension values; StringFormat copy inside bindings is a known blind spot to sweep by hand.
- **Font glyph coverage:** display fonts often cover less of Unicode than body fonts. Verify glyph coverage per target language (Cyrillic, Vietnamese diacritics, CJK) before shipping a culture.
- **RTL surface:** XAML layouts assume LTR (`FlowDirection`). Flag before adding Arabic / Hebrew / Urdu.

