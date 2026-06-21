// Adapter STUB — react-i18next. Declared, NOT implemented (M5 seam).
//
// react-i18next is the dominant SPA / Pages-Router i18n library. It wires an
// `i18n.ts` init + `I18nextProvider` + `useTranslation()` — a different template
// world from next-intl's request.ts / NextIntlClientProvider. The stub exists so
// the registry can NAME this framework when it sees it and report
// `not-yet-implemented` honestly, instead of mis-handling the app with the
// next-intl adapter or crashing.
//
// matches() is INFORMATIONAL only: the registry maps any stub match to
// { adapter: null, status: 'not-yet-implemented' }. The mutating methods exist to
// satisfy the FrameworkAdapter shape and to throw loudly if ever called directly.

const NOT_IMPLEMENTED = "vibe-lingual: the react-i18next adapter is declared but not yet implemented";

function notImplemented() {
  throw new Error(NOT_IMPLEMENTED);
}

export const reactI18nextStub = {
  id: 'react-i18next',
  implemented: false,
  framework: 'react-i18next',

  // Claims an app whose detected framework is react-i18next (a react-i18next /
  // i18next dependency is installed). Informational — see header.
  matches(detection) {
    const fw = detection && detection.app && detection.app.framework;
    return fw === 'react-i18next' || fw === 'i18next' || fw === 'react-intl';
  },

  wire: notImplemented,
  transform: notImplemented,
  emitParityTest: notImplemented,
  emitGuard: notImplemented,

  capabilities: { ssr: false, cookieLocale: false, dateFormatter: false, dualLocale: false },
};

export default reactI18nextStub;
