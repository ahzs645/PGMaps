import { ReactNode } from 'react'
import { AppUpdateNotice } from '@/updates/AppUpdateNotice'
import { Navbar } from './Navbar'

interface ShellProps {
  children: ReactNode
}

export function Shell({ children }: ShellProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <a
        href="#main-content"
        onClick={() => document.getElementById('main-content')?.focus()}
        className="sr-only fixed left-3 top-3 z-[1400] rounded-md bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-lg focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-auto focus:outline-none">
        {children}
      </main>
      <AppUpdateNotice />
    </div>
  )
}
