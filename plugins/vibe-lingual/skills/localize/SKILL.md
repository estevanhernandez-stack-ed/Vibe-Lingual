---
name: localize
description: This skill should be used when the user says "/vibe-lingual:localize", "localize my app", "extract my strings to next-intl", "wire up i18n", or wants to run the mutating localization loop. Reads inventory.json + audit.json + the matched adapter, then runs extract -> wire -> translate -> guard with confidence routing (high auto-write+backup / medium stage / low inline-only), per-file backup + rollback, and idempotent re-runs. Mutates the target — confidence-routed and reversible.
---

# /vibe-lingual:localize — the mutating loop

Implemented in a later milestone (M8). For now this is a header-only stub.
