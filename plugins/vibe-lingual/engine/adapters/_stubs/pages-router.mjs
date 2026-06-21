// Adapter STUB — Next.js Pages Router. Declared, NOT implemented (M5 seam).
//
// next-intl's App-Router adapter does NOT handle the Pages Router: Pages Router
// i18n uses `next-i18next` / built-in `i18n` routing in next.config + `getStatic
// Props`/`getServerSideProps`-loaded namespaces — a fundamentally different wiring
// surface from App Router's request.ts + RSC `getTranslations`. The stub exists so
// the registry recognizes a Pages-Router app and stands down cleanly rather than
// trying to wire App-Router templates into a tree that has no `app/` directory.
//
// matches() is INFORMATIONAL only: any stub match → not-yet-implemented.

const NOT_IMPLEMENTED = "vibe-lingual: the Pages Router adapter is declared but not yet implemented";

function notImplemented() {
  throw new Error(NOT_IMPLEMENTED);
}

export const pagesRouterStub = {
  id: 'pages-router',
  implemented: false,
  framework: 'pages-router',

  // Claims any app whose router type is Pages Router. This is what disqualifies a
  // pages-router app from the next-intl (App Router) adapter even when a next-intl
  // dependency happens to be installed. Informational — see header.
  matches(detection) {
    const rt = detection && detection.app && detection.app.routerType;
    return rt === 'pages';
  },

  wire: notImplemented,
  transform: notImplemented,
  emitParityTest: notImplemented,
  emitGuard: notImplemented,

  capabilities: { ssr: true, cookieLocale: false, dateFormatter: false, dualLocale: false },
};

export default pagesRouterStub;
