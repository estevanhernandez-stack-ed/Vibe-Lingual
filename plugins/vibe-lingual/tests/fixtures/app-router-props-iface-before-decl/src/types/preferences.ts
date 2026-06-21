// DECLARATION SITE — the source of truth. Walks AFTER
// components/settings/LanguageSettings.tsx (types/ sorts after components/), so
// this case only passes if the detector REJECTS the earlier `*Props`-interface
// field and keeps scanning to the real preference declaration here.
// Mirrors the real Celestia3 src/types/preferences.ts:59-73 (UserPreferences).
export interface UserPreferences {
  name: string;
  outputLanguage?: string; // ISO code for AI output language; default 'en'
  uiLanguage?: string; // ISO code for the UI/interface language; default 'en'
}
