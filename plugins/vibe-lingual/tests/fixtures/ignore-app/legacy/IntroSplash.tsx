// Dead legacy intro code — eslint-ignored (globalIgnores legacy/**), never shipped.
// If the scanner did NOT respect the ignore signals, this file's JSX text would
// pollute the inventory. The test asserts it does NOT appear.

export default function IntroSplash() {
  return (
    <div className="legacy-splash">
      <h1>Legacy intro headline that must never be localized</h1>
      <p>This dead-code paragraph should be excluded from the inventory</p>
    </div>
  );
}
