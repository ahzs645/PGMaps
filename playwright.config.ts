import { defineConfig, devices } from '@playwright/test'

const browserExecutablePath = process.env.PGMAPS_PLAYWRIGHT_EXECUTABLE_PATH
const externalBaseURL = process.env.PGMAPS_E2E_BASE_URL

/**
 * Chromium does not read `HTTPS_PROXY`, so behind a proxy every basemap, tile
 * and DataBC request fails with `ERR_TOO_MANY_RETRIES` and the map never
 * paints — while curl from the same shell succeeds, which makes it look like a
 * page bug rather than a network one.
 *
 * Scheme-scoped on purpose: `https=` sends only https:// through the relay and
 * leaves plain http:// direct. Proxying everything sends the dev server's own
 * http:// requests to the relay too, and a relay that only accepts CONNECT
 * tunnels answers those with an error page instead of the app.
 *
 * The suite stubs its network, so this changes nothing there; it is what makes
 * a live-data run against a real basemap possible at all.
 */
const proxyArgs = process.env.HTTPS_PROXY ? [`--proxy-server=https=${process.env.HTTPS_PROXY}`] : []

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
    baseURL: externalBaseURL ?? 'http://127.0.0.1:42173',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    launchOptions: {
      ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
      args: [
        ...(browserExecutablePath
          ? []
          : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']),
        ...proxyArgs,
      ],
    },
  },
  webServer: externalBaseURL
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 42173 --strictPort',
        url: 'http://127.0.0.1:42173',
        reuseExistingServer: false,
        timeout: 120_000,
        // The forestry field-photo tests stub the Graph API, so any token will do;
        // a real one in .env.local is overridden rather than spent on test runs.
        env: { VITE_MAPILLARY_TOKEN: 'MLY|e2e-stub' },
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
