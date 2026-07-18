/** Pure business logic (src/domain) runs under plain Node — no native deps,
 *  no simulator. UI/component tests, if added later, get their own project. */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Native Keychain module — in-memory stand-in under Node.
    '^expo-secure-store$': '<rootDir>/src/testing/expo-secure-store.mock.ts',
  },
};
