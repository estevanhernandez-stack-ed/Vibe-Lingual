// AI output language list — already present before any UI i18n work.
// Mirrors the Celestia3 SUPPORTED_LANGUAGES shape the detector must find.
type AppLanguage = { code: string; name: string };

export const SUPPORTED_LANGUAGES: ReadonlyArray<AppLanguage> = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'ja', name: 'Japanese' },
];

let outputLanguage = 'en';

export function setOutputLanguage(code: string) {
  outputLanguage = code || 'en';
}

export function getOutputLanguage() {
  return outputLanguage;
}
