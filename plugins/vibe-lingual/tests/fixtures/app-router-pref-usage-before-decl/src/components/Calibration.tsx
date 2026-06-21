// USAGE SITE — walks BEFORE src/types/preferences.ts (components/ < types/).
// Mirrors the real Celestia3 CosmicCalibration.tsx:416 shapes that the OLD
// LOCALE_PREF_RE wrongly matched as a declaration: a JSX attribute and an
// object property. Neither is a declaration; the detector must skip both and
// resolve localePref to the real type-field declaration in preferences.ts.
import { LanguageSettings } from './LanguageSettings';
import { updatePreferences, preferences } from '../types/preferences';

export function Calibration() {
  return (
    <div className="space-y-12">
      <LanguageSettings
        uiLanguage={preferences.uiLanguage ?? 'en'}
        onUiLanguageChange={(code: string) => updatePreferences({ uiLanguage: code })}
      />
    </div>
  );
}
