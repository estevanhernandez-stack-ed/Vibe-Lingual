// Cloud Functions — a SEPARATE package (globalIgnores functions/**). Carries a
// toast/Error literal that would be captured if functions/ were not excluded.

export function buildNotification() {
  throw new Error('A functions-package error string that must not be localized');
}
