/** Pure business logic (src/domain) runs under plain Node — no native deps,
 *  no simulator. UI/component tests, if added later, get their own project. */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
};
