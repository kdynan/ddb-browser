import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'] } },
      {
        test: {
          name: 'api',
          include: ['tests/api/**/*.test.ts'],
          globalSetup: ['tests/api/global-setup.ts'],
          testTimeout: 30_000,
          // Never read the developer's real AWS configuration.
          env: {
            AWS_CONFIG_FILE: 'tests/.no-aws-config',
            AWS_SHARED_CREDENTIALS_FILE: 'tests/.no-aws-credentials',
          },
        },
      },
    ],
  },
})
