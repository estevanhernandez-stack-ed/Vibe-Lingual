// Jest config for the vibe-lingual engine.
// The engine + tests are native ESM (.mjs); no Babel transform is needed.
// Native ESM is enabled via NODE_OPTIONS=--experimental-vm-modules (see package.json test script).
// Fixture .tsx/.ts files are read as TEXT by the detector — never imported — so jest never
// has to parse them, which keeps the test toolchain transform-free.
export default {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.mjs'],
  transform: {},
  // Fixtures are data, not test subjects — never collect or execute them.
  testPathIgnorePatterns: ['/node_modules/', '/tests/fixtures/'],
};
