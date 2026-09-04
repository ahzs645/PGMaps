import { defineConfig, devices } from '@playwright/test'

const browserExecutablePath = process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Each test boots a SwiftShader-rendered MapLibre page; more than a few at
  // once starves the CPU and freezes pages mid-test.
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  // Map pages boot MapLibre on SwiftShader; under parallel load the default
  // 5s expect timeout flakes on first paint.
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://127.0.0.1:42173',
    trace: 'on-first-retry',
    launchOptions: {
      ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'],
    },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 42173 --strictPort',
    url: 'http://127.0.0.1:42173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
