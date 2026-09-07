// wpf-resx adapter — wire(): the framework wiring plan for a WPF app.
//
// WPF's i18n infrastructure is not a request loader and a provider mount — it is
// a compiled resx catalog, a designer class the XAML addresses via x:Static, per-
// culture satellite assemblies the runtime probes automatically, and ONE line of
// culture selection that must run before any UI is constructed. wire() returns
// the plan (WiredFileSet: files + patches + notes); the SKILL/CLI writes it.
//
// The honesty rule travels with the plan: the package manifest declares a
// language ONLY when the UI genuinely ships it (a declared language the UI
// cannot speak is a Store-facing lie).

import { emitResx } from './resx.mjs';

export function wire(ctx = {}) {
  const resxDir = ctx.resxDir || 'Properties';
  const resourceClass = ctx.resourceClass || 'Strings';
  const clrNamespace = ctx.clrNamespace || '<RootNamespace>.Properties';
  const locales = Array.isArray(ctx.locales) ? ctx.locales : [];
  const resxPath = `${resxDir}/${resourceClass}.resx`;

  const files = [
    {
      path: resxPath,
      contents: emitResx([]),
    },
    {
      path: `${resxDir}/CultureBootstrap.cs.snippet`,
      contents: [
        `// wpf-resx wiring — culture selection. Call ONCE, before ANY UI element is`,
        `// constructed (in WPF, before the first window/theme resource is touched —`,
        `// place it at the very top of the app's startup path).`,
        `//`,
        `// var culture = /* the saved UI-language preference, else CultureInfo.CurrentUICulture */;`,
        `// System.Threading.Thread.CurrentThread.CurrentUICulture = culture;`,
        `// System.Globalization.CultureInfo.DefaultThreadCurrentUICulture = culture;`,
        `//`,
        `// A changed preference takes effect on the next launch (x:Static binds once);`,
        `// say so next to the language picker rather than pretending it is live.`,
        ``,
      ].join('\n'),
    },
  ];

  const patches = [
    {
      file: '<app>.csproj',
      kind: 'resx-public-codegen',
      description:
        `Add to the csproj so the designer class is PUBLIC (x:Static needs it):\n` +
        `  <ItemGroup>\n` +
        `    <EmbeddedResource Update="${resxPath}">\n` +
        `      <Generator>PublicResXFileCodeGenerator</Generator>\n` +
        `      <LastGenOutput>${resourceClass}.Designer.cs</LastGenOutput>\n` +
        `    </EmbeddedResource>\n` +
        `  </ItemGroup>\n` +
        `Per-culture files (${resourceClass}.<culture>.resx) need no entry — the SDK builds\n` +
        `satellite assemblies from them automatically.`,
    },
    {
      file: '<app startup>',
      kind: 'culture-bootstrap',
      description:
        'Apply the saved UI culture before any UI construction (see CultureBootstrap.cs.snippet). ' +
        'In apps with a load-bearing startup order, culture goes FIRST.',
    },
  ];

  const notes = [
    `x:Static references (${resourceClass}.Key) are compile-checked: a typo'd key is a build error, not a blank label.`,
    'Satellite assemblies land in <culture>/ subfolders of the output; MSIX packaging picks them up automatically.',
    'The package manifest declares a language ONLY when the UI genuinely ships it — listing languages need no manifest change at all.',
    locales.length
      ? `Per-culture catalogs to create once keys exist: ${locales.map((l) => `${resxDir}/${resourceClass}.${l}.resx`).join(', ')}.`
      : 'Pass locales to plan the per-culture catalog files.',
    'x:Static binds once at load — a language change applies on restart; the settings copy should say so.',
  ];

  return { files, patches, notes };
}

export default wire;
