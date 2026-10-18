import React from 'react'
import ReactDOM from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { LidarWorkspace } from '../src/pages/dev-lidar/LidarWorkspace'
import '../src/index.css'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider attribute="class" defaultTheme="light">
      <LidarWorkspace
        cloudBase={new URL('/data/lidar/', location.origin).href}
        analysisBase={new URL('/data/lidar-analysis/bc-093g086/', location.origin).href}
      />
    </ThemeProvider>
  </React.StrictMode>,
)
