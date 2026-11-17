import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { NotificationProvider } from '@/components/ui/notification'
import { initializeInterfaceTheme } from '@/lib/interfaceTheme'
import { installOverlayScrollbars } from '@/lib/overlayScrollbars/install'
import { ROAD_DESIGNER_PATH } from '@/pages/help/helpLinks'
import '@pgmaps/geo-toolkit/styles.css'
import '@/index.css'
import './standalone.css'

// The same designer and help PGMaps serves at /dev/forestry/road-design and /help, on a site of
// their own: no PGMaps router, navbar or service worker. Where the site lives comes from the build's
// variables (`.env` beside this file, guide docs/forestry-road-design/standalone-build.md).
const RoadDesign = lazy(() => import('@/pages/ForestryRoadWorkspace'))
const Help = lazy(() => import('@/pages/help/Help'))

initializeInterfaceTheme()
installOverlayScrollbars()

const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'
const loading = (
  <p className="p-6" role="status">
    Opening the road workspace…
  </p>
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="forestry-road-design-theme">
      <BrowserRouter basename={basename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <NotificationProvider>
          <main id="main-content" tabIndex={-1} className="h-full overflow-auto focus:outline-none">
            <ErrorBoundary>
              <Suspense fallback={loading}>
                <Routes>
                  <Route path={ROAD_DESIGNER_PATH} element={<RoadDesign />} />
                  <Route path="/help" element={<Help />} />
                  <Route path="/help/*" element={<Help />} />
                  <Route path="*" element={<Navigate to={ROAD_DESIGNER_PATH} replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
        </NotificationProvider>
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
