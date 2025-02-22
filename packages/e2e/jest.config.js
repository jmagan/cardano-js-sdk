/* eslint-disable sonarjs/no-duplicate-string */
module.exports = {
  projects: [
    {
      displayName: 'blockfrost',
      preset: 'ts-jest',
      setupFiles: ['dotenv/config'],
      testMatch: ['<rootDir>/test/blockfrost/*.test.ts'],
      transform: {
        '^.+\\.tsx?$': 'ts-jest'
      }
    },
    {
      displayName: 'wallet',
      preset: 'ts-jest',
      setupFiles: ['dotenv/config'],
      testMatch: ['<rootDir>/test/wallet/**/*.test.ts'],
      transform: {
        '^.+\\.test.ts?$': 'ts-jest'
      }
    },
    {
      displayName: 'local-network',
      preset: 'ts-jest',
      setupFiles: ['dotenv/config'],
      testMatch: ['<rootDir>/test/local-network/**/*.test.ts'],
      transform: {
        '^.+\\.test.ts?$': 'ts-jest'
      }
    },
    {
      displayName: 'load-testing',
      preset: 'ts-jest',
      setupFiles: ['dotenv/config'],
      testMatch: ['<rootDir>/test/load-testing/**/*.test.ts'],
      transform: {
        '^.+\\.test.ts?$': 'ts-jest'
      }
    }
  ],
  testTimeout: 120_000_000
};
