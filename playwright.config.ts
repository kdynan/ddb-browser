import { defineConfig, devices } from '@playwright/test'

const PORT = 4610

// Browser tests: the built app served by the real server, against a throwaway DynamoDB.
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 850 } } }],
  webServer: {
    command: 'npm run build && npm run serve',
    url: `http://localhost:${PORT}/api/about`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      // Never read the developer's real AWS configuration.
      AWS_CONFIG_FILE: 'tests/.no-aws-config',
      AWS_SHARED_CREDENTIALS_FILE: 'tests/.no-aws-credentials',
      AWS_ACCESS_KEY_ID: '',
    },
  },
})
