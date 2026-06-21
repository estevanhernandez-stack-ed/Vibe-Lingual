// DECLARATION SITE — the source of truth. Walks AFTER components/Calibration.tsx
// (types/ sorts after components/), so this case only passes if the detector
// rejects the earlier usage sites and keeps scanning to the real declaration.
// Mirrors the real Celestia3 src/types/preferences.ts:73.
export interface UserPreferences {
  outputLanguage?: string; // ISO code for AI output language; default 'en'
  uiLanguage?: string; // ISO code for the UI/interface language; default 'en'
}

// An object-literal default — NOT a declaration. The value is a string
// expression, not a type, so the detector must not match it.
export const preferences: UserPreferences = {
  uiLanguage: 'en',
};

export function updatePreferences(_patch: Partial<UserPreferences>) {}
