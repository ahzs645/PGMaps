import { defineConfig, devices } from '@playwright/test'

const chromiumPath = process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH
const webkitPath = process.env.PGMAPS_WEBKIT_EXECUTABLE_PATH
const baseURL = process.env.PGMAPS_E2E_BASE_URL
const chrome = {
  ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-gpu-sandbox',
    ...(process.env.CI ? ['--disable-gpu-compositing'] : []),
  ],
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'mmgis-parity.spec.ts',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 90000,
  expect: { timeout: 15000 },
  reporter: 'html',
  outputDir: 'test-results/mmgis-parity',
  use: {
    baseURL: baseURL ?? 'http://127.0.0.1:42174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    actionTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 960 },
        deviceScaleFactor: 1,
        launchOptions: chrome,
      },
    },
    {
      name: 'chromium-touch',
      use: {
        ...devices['Pixel 7'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        launchOptions: chrome,
      },
    },
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1440, height: 960 },
        deviceScaleFactor: 1,
        launchOptions: webkitPath ? { executablePath: webkitPath } : {},
      },
    },
    {
      name: 'webkit-touch',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        launchOptions: webkitPath ? { executablePath: webkitPath } : {},
      },
    },
  ],
  webServer: baseURL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 42174 --strictPort',
        url: 'http://127.0.0.1:42174',
        reuseExistingServer: false,
        timeout: 120000,
      },
})
