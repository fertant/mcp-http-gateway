module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverage: true,
  coverageReporters: ['text', 'lcov'],
  coverageDirectory: 'coverage',
  setupFilesAfterEnv: ['./test/jest.setup.js'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      // ts-jest configuration options
      tsconfig: 'tsconfig.json',
    }],
    '^.+\\.jsx?$': 'babel-jest',
  },
  // Ignore node_modules and dist directories
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  // Module name mapper for aliases if needed
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  // Transform node_modules that use ESM
  transformIgnorePatterns: [
    '/node_modules/(?!(openapi-overlays-js)).+\\.js$'
  ],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
};
