---
name: first-run-setup
description: Internal SKILL invoked on first invocation of /vibe-lingual:localize in a target app (or directly when the user says "set up vibe-lingual", "init vibe-lingual"). Captures the detected framework + the matched adapter + the soft decisions (timeZone, dual-locale, locales, catalog layout) and writes .vibe-lingual/config.json. Idempotent — re-runnable to refresh a stale capture. Read-only on source.
---

# first-run-setup (internal)

Capture the per-app localization config the `localize` loop reads, ONCE, on first run — so the mutating loop doesn't re-derive the framework, re-resolve the adapter, or re-ask the soft decisions every time. Idempotent: re-running refreshes a stale config (e.g. after the app installed next-intl, or the language list changed).

This SKILL is read-only on source. It writes exactly one file: `.vibe-lingual/config.json` in the target app.

## When it runs

- Automatically, the first time `/vibe-lingual:localize` is invoked in an app with no `.vibe-lingual/config.json`.
- Directly, when the user says "set up vibe-lingual" / "init vibe-lingual" / `/vibe-lingual:first-run-setup`.
- Re-run any time to refresh — it never destroys catalogs or source, only the config capture.

## Inputs

- The target app root (cwd or a path argument).
- The detection result from the engine (`node engine/cli.mjs detect <appRoot>`), which already carries framework + routerType + Turbopack + SSR files + the existing-i18n map (language list + locale pref).

## What it captures (→ `.vibe-lingual/config.json`, validates against `schemas/config.schema.json`)

| Field | Source | Notes |
|---|---|---|
| `framework` | detection | `next-intl` / `react-i18next` / … / `none`. |
| `adapter` | registry (`resolveAdapter`) | `next-intl` when an implemented adapter claims the app; else `not-yet-implemented` (localize will refuse to mutate). |
| `routerType` | detection | `app` / `pages` / `unknown`. |
| `sourceLocale` | interview / default | The catalogs' source-of-truth locale (always generated first). Default `en`. |
| `locales` | reused list / interview | The UI locale set. Reuse a detected `SUPPORTED_LANGUAGES`-shaped list rather than generating a parallel one. |
| `messagesDir` | interview / default | Catalog dir. Default `messages`. |
| `catalogLayout` | default | `split-by-namespace` (cowpath default) or `flat`. |
| `cookieName` | default | The UI-locale cookie. Default `NEXT_LOCALE`. |
| `existingLanguageList` | detection | The app-owned list (file + symbol + codes) to reuse for the picker. |
| `decisions.timezone` | interview (REQUIRED if date sites) | `client-browser-zone` / `ssr-explicit-zone` / `mixed`. Surfaced, never auto-picked. |
| `decisions.dualLocale` | interview | `separate` / `lockstep`. Surfaced when the app already controls a content/output locale. |
| `decisions.htmlLang` | interview | `yes` / `defer`. |

## Workflow

1. `session-logger` start. Resolve the app root; confirm a `package.json` exists (else exit cleanly — not a recognized stack).
2. Run `detect`. Resolve the adapter. If no implemented adapter claims the app, still write the config with `adapter: "not-yet-implemented"` (so the router + localize can report cleanly) and tell the user v1 only mutates next-intl App Router apps.
3. Reuse the detected language list for `locales` when present; otherwise ask for the target locale set (or default to `[sourceLocale]`).
4. Surface the decisions that apply — the REQUIRED `timezone` one (when presentational date sites exist), `dual-locale` (when a content/output locale pref exists), `html-lang` (when an App Router layout exists). Use AskUserQuestion. Record answers; leave unanswered ones `null` (localize will gate on the REQUIRED one).
5. Write `.vibe-lingual/config.json` (atomic) with `schemaVersion: 1` + `capturedAt`. Validate against the schema before surfacing success.
6. `session-logger` terminal.

## Rules

- Idempotent. Re-running refreshes the config; it never touches catalogs or source.
- Read-only on source. The only write is `.vibe-lingual/config.json`.
- Never auto-resolve the REQUIRED timeZone decision — capture it as `null` if unanswered and let localize gate.
- No secrets. The config records detection + decisions only, never an API key.
