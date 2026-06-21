// Adapter STUB — vue-i18n. Declared, NOT implemented (M5 seam).
//
// vue-i18n is the Vue ecosystem's i18n library (Nuxt @nuxtjs/i18n / vue-i18n). It
// is a different language and component model entirely — `.vue` SFCs, the
// Composition API `useI18n()`, `$t` in templates — none of which the React/JSX
// scan + the next-intl codemod address. The stub exists so the registry NAMES Vue
// when it sees it and reports `not-yet-implemented`, instead of running a JSX
// codemod over Vue templates.
//
// Vue is NOT in the M1 detect() framework enum (the engine is React/Next-focused),
// so a Vue app surfaces as a `vue`/`vue-i18n` framework only when an upstream
// detector tags it, or via a synthetic detection. matches() covers both the
// framework tag and a Vue dependency signal if one is threaded through.
//
// matches() is INFORMATIONAL only: any stub match → not-yet-implemented.

const NOT_IMPLEMENTED = "vibe-lingual: the vue-i18n adapter is declared but not yet implemented";

function notImplemented() {
  throw new Error(NOT_IMPLEMENTED);
}

export const vueI18nStub = {
  id: 'vue-i18n',
  implemented: false,
  framework: 'vue-i18n',

  // Claims an app tagged as Vue / vue-i18n. Informational — see header.
  matches(detection) {
    const app = (detection && detection.app) || {};
    const fw = app.framework;
    return fw === 'vue-i18n' || fw === 'vue' || app.vue === true;
  },

  wire: notImplemented,
  transform: notImplemented,
  emitParityTest: notImplemented,
  emitGuard: notImplemented,

  capabilities: { ssr: false, cookieLocale: false, dateFormatter: false, dualLocale: false },
};

export default vueI18nStub;
