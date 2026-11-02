import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter } from 'react-router-dom'
import DevForestryCastor from '@/pages/DevForestryCastor'
import '@pgmaps/geo-toolkit/styles.css'
import '@/index.css'

const root = document.getElementById('root')
if (!root) throw new Error('The forestryCastor application root is missing.')

// The same workbench component, worker and exporters also serve the PGMaps route.
// A separate entry keeps the unrelated PGMaps router and service worker out of
// this static application; it is not a second model or a reduced feature set.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="forestry-castor-theme"
      // This client-only entry needs no inline SSR bootstrap. Keep that script
      // inert under the CSP; next-themes effects still apply and update themes.
      scriptProps={{ type: 'application/x-forestrycastor-theme-bootstrap' }}
    >
      <BrowserRouter basename={basename} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <DevForestryCastor standalone />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
