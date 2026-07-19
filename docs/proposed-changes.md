# Proposed changes

The target file `evolve-lingual` is specified to write. **Hand-authored for now** — the session-logger and friction-logger are documentation-only placeholders in v0.1, and both reserved data paths (`~/.claude/plugins/data/vibe-lingual/` and `~/.claude-personal/plugins/data/vibe-lingual/`) were **absent** after a full live-use session, so there was no logged data for `evolve-lingual` to weight. Until the loggers actually write, evolution input has to be captured by hand from dogfood reports.

Entries are sourced from dated dogfood docs; each names its origin.

---

## From M11 (Celestia3 live-use, 2026-07-19)

### P1 — Stamp and check inventory freshness *(DEFECT 7)*

**Change:** add `capturedAt` (ISO string) to `inventory.json` and to `schemas/inventory.schema.json`. Have `localize` and the router compare it against the newest tracked source mtime; warn on stale, and do not present a "nothing to extract" result from an inventory older than the newest source file without flagging it.

**Why:** a four-week-old inventory produced `0 written, all skipped-no-change` — which reads as "extraction complete" — while a fresh scan found a materially different 358-site file set. The inventory currently carries **no timestamp of any kind**, so staleness is undetectable rather than merely unchecked. A confident false negative is the worst failure mode for a tool whose job is finding remaining work.

### P2 — Route the staged branch off the manifest, not the directory *(DEFECT 6)*

**Change:** router branch 4 triggers on `Object.keys(stagedManifest.files).length > 0`, not on `staged/` being non-empty. Additionally, don't leave empty scaffolding dirs behind when a batch stages nothing (or prune them).

**Why:** a prior run left empty `staged/messages/en/` and `staged/src/components/` dirs plus a `{"files": {}}` manifest. The router announced "staged rewrites pending" with zero staged rewrites — a false statement in the first banner a user sees on a real repo.

### P2 — Close the `translate` honesty seam *(DEFECT 8)*

**Change:** either implement `translate` as a real engine subcommand, or state plainly in the localize SKILL, the README, and the `--phase` table that translate is **agent-driven with no engine backing**, and that translation *quality* is out of scope.

**Why:** the engine exposes `scan|audit|extract|wire|parity|detect` — no `translate` — while the documented arc, SKILL §6, and `--phase translate` all imply a pipeline step. A real user reached for this plugin specifically because they couldn't hand-write es/ja and expected pipeline-quality translation; what exists is an LLM pass with the same review problem. The plumbing (extract/wire/parity/guard) is genuinely strong and should be what the seam advertises.

### P3 — Consider a "not codemod work" heuristic in scan block 5

**Change:** flag legal (`privacy`, `terms`) and marketing/SEO content routes as a distinct category in the scan brief rather than folding them into the extractable site count.

**Why:** on a mature app the tool correctly drove the chrome to zero and the remaining 337 sites were privacy (60), terms (34), billing (33), and `/learn/*` SEO content (~63). Those are a liability surface and a content-strategy decision respectively, not codemod work. Reaching that state is a legitimate *finish line*, and the tool currently has no way to say so.

### P3 — Repro note: `localize` SKILL did not load via the Skill tool

Not a plugin defect on current evidence, but worth reproducing: in one session `router` and `guide` loaded normally while `localize` (invoked with `--dry-run` as an argument) returned only a launch line twice, then reported "already loaded" without ever delivering the body. If it recurs, check whether arguments interact with skill delivery.
