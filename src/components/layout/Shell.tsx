import { ReactNode } from 'react'
import { Navbar } from './Navbar'

interface ShellProps {
  children: ReactNode
}

export function Shell({ children }: ShellProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Navbar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  )
}
