module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/backend/**/*.test.ts'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: { '^.+\\.tsx?$': ['ts-jest', { tsconfig: { types: ['node', 'jest'], strict: true } }] },
  moduleNameMapper: {
    '^@flexsdk/runtime$': '<rootDir>/tests/backend/flexsdk-runtime.ts'
  }
};
