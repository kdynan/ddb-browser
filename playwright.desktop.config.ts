import { defineConfig } from '@playwright/test'

// Smoke tests for the Electron app. Run `npm run test:desktop`, which builds it first.
export default defineConfig({
  testDir: 'tests/desktop',
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-desktop' }]] : 'list',
  use: { trace: 'retain-on-failure' },
})
