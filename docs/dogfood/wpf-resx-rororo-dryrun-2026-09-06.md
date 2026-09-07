# WPF dogfood, mutating half — RoRoRo dry-run, 2026-09-06

> Same-day dogfood of the wpf-resx adapter's extract loop against RoRoRo (`ROROROblox`),
> dry-run (zero writes). One day after the read side counted the surface, the write side
> can sweep it:

```
vibe-lingual extract (wpf, dry-run): 29 file(s) rewritten, 470 entrie(s) added
(470 total) → src/ROROROblox.App/Properties/Strings.resx, 7 site(s) staged for
hand conversion
```

- **528 sites → 470 resx entries** (identical text dedupes to shared keys) across
  **29 of 29 files with sites** — a ~99% mechanical sweep.
- **7 staged, all correctly routed**: four `Hyperlink` inner texts (Inlines content — real
  markup surgery), three inline-split sentence fragments in `SquadLaunchWindow` (mixed
  `Run`/text content). Nothing was guessed.
- The first dry-run staged 9: the extra two were **brand font stacks inside `<FontFamily>`
  value elements** — a scanner false positive fixed in the same change (value-typed
  elements are excluded by name now), which also dropped the inventory 530 → 528.
- Idempotence held in the fixture round-trip: extracting an extracted tree changes zero
  files and adds zero entries; dry-run leaves byte-identical sources and opens no backup
  batch.

The real run on RoRoRo is the target repo's own cycle (its branch, its fences, its
translations); this record is the adapter's proof it is ready for it.
