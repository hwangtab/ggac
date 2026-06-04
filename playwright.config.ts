import { defineConfig, devices } from '@playwright/test'

if (process.env.FORCE_COLOR) {
  delete process.env.NO_COLOR
}

const isCI = !!process.env.CI
const port = Number(process.env.PLAYWRIGHT_PORT || 3100)
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: 1,
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
    command: `env -u NO_COLOR PORT=${port} npm run dev`,
    url: `${baseURL}/robots.txt`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
})
