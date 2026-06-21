// PROPS-INTERFACE DECOY — walks BEFORE src/types/preferences.ts
// (components/ sorts ahead of types/). This is the EXACT shape that broke on the
// real Celestia3 reference: a component's `*Props` interface carrying a
// `uiLanguage: string;` field. It is form (3) `<symbol>: <type>;` — the same
// shape as the real declaration — so the bare LOCALE_PREF_RE matches it. The
// detector must reject it because the enclosing interface is named
// `LanguageSettingsProps` (a component props shape), NOT a preferences store.
// Mirrors Celestia3 src/components/settings/LanguageSettings.tsx:8-13.
"use client";

import { useTranslations } from 'next-intl';

interface LanguageSettingsProps {
  uiLanguage: string;
  readingLanguage: string;
  onUiLanguageChange: (code: string) => void;
  onReadingLanguageChange: (code: string) => void;
}

export default function LanguageSettings({
  uiLanguage,
  onUiLanguageChange,
}: LanguageSettingsProps) {
  const t = useTranslations('LanguageSettings');
  return (
    <select value={uiLanguage} onChange={(e) => onUiLanguageChange(e.target.value)}>
      <option>{t('placeholder')}</option>
    </select>
  );
}
