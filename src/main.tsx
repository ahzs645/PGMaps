import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import '@pgmaps/geo-toolkit/styles.css'
import './index.css'
import { dataHostOrigins } from '@/lib/dataHosts'
import { DATA_HOSTS } from '@/lib/dataUrl'
import { initializeInterfaceTheme } from '@/lib/interfaceTheme'

initializeInterfaceTheme()

// The service worker caches aggressively, so it stays production-only; in dev
// it would keep serving stale modules across edits.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (import.meta.env.PROD) {
      // Data hosts other than this site get the same cache rules as /data here.
      const dataOrigins = dataHostOrigins(DATA_HOSTS)
      const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js${
        dataOrigins.length > 0 ? `?dataOrigins=${encodeURIComponent(dataOrigins.join(','))}` : ''
      }`
      void navigator.serviceWorker
        .register(serviceWorkerUrl, { updateViaCache: 'none' })
        .then((registration) => registration?.update())
        .catch(() => {
          // Offline caching is optional; restricted browsers and failed updates
          // must not produce an unhandled rejection while the app is usable.
        })
    } else {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => void registration.unregister())
      })
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>,
)
