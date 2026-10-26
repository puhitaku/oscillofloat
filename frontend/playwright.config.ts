import { defineConfig, devices } from '@playwright/test'

// The tests mock /api and /ws, so only the Vite dev server is needed.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5184' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --port 5184 --strictPort',
    url: 'http://localhost:5184',
    reuseExistingServer: !process.env.CI,
  },
})
