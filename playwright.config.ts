import { defineConfig, devices } from '@playwright/test'

const isCI = !!process.env.CI
const port = Number(process.env.PLAYWRIGHT_PORT || 3100)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? 'github' : 'list',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: `PORT=${port} npm run dev`,
    url: baseURL,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
