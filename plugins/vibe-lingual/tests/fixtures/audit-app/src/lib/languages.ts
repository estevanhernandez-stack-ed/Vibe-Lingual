// Existing-i18n map: a SUPPORTED_LANGUAGES list (reuse it for the UI picker) + an
// outputLanguage pref. The pref drives AI/content output language — so the audit
// must surface the dual-locale decision (model UI locale SEPARATELY from this
// content locale; they do not move in lockstep).

export const SUPPORTED_LANGUAGES = ['en', 'es', 'ja', 'ar', 'he', 'ur', 'fr', 'de', 'pt', 'zh'];

export interface UserPreferences {
  outputLanguage: string;
  theme: 'light' | 'dark';
}

export function buildLanguageDirective(pref: UserPreferences): string {
  return `Respond in ${pref.outputLanguage}.`;
}
