export interface UserPreferences {
  outputLanguage?: string; // ISO code for AI output language; default 'en'
  uiLanguage?: string; // ISO code for the UI/interface language; independent of outputLanguage
}
