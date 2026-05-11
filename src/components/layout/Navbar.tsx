import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Map, Layers, Calculator, Wind, BarChart3, Trees, Sun, Moon, ShieldAlert, Building2, Menu, X, UtensilsCrossed, Database, Droplets } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { GlobalSearch } from '@/components/GlobalSearch'
import { cn } from '@/lib/utils'

const navLinks = [
  { path: '/', label: 'Home', icon: Map },
  { path: '/foodmap', label: 'Food Safety', icon: UtensilsCrossed },
  { path: '/airquality', label: 'Air Quality', icon: Wind },
  { path: '/pgdata?tab=parks', label: 'Parks & Trails', icon: Trees },
  { path: '/census', label: 'Census', icon: BarChart3 },
  { path: '/explorer', label: 'Explorer', icon: Layers },
  { path: '/score-builder', label: 'Index Lab', icon: Calculator },
  { path: '/bc-assessment', label: 'Assessment', icon: Building2 },
  { path: '/drought', label: 'Drought', icon: Droplets },
  { path: '/pgdata', label: 'PG Data', icon: ShieldAlert },
  { path: '/misc', label: 'MISC', icon: Database },
]

export function Navbar() {
  const location = useLocation()
  const { resolvedTheme, setTheme } = useTheme()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const locationParams = new URLSearchParams(location.search)

  const toggleTheme = () => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
  }

  const isNavActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    if (path === '/pgdata?tab=parks') {
      return location.pathname === '/pgdata' && locationParams.get('tab') === 'parks'
    }
    if (path === '/pgdata') {
      return location.pathname === '/pgdata' && locationParams.get('tab') !== 'parks'
    }
    return location.pathname === path
  }

  // Close mobile menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        !menuButtonRef.current?.contains(target)
      ) {
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [mobileMenuOpen])

  const mobileMenu = mobileMenuOpen && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          className="fixed inset-x-0 top-14 z-[1000] border-b border-border bg-background/95 shadow-lg backdrop-blur lg:hidden"
        >
          <nav className="flex flex-col p-2">
            {navLinks.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium transition-colors",
                  isNavActive(path)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            ))}
          </nav>
        </div>,
        document.body,
      )
    : null

  return (
    <header className="h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-full items-center justify-between gap-2 px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-3 xl:gap-6">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Map className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-semibold">PGMaps</span>
          </Link>

          <nav className="hidden min-w-0 items-center gap-1 lg:flex">
            {navLinks.map(({ path, label, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                aria-label={label}
                title={label}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors xl:px-3",
                  isNavActive(path)
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden xl:inline">{label}</span>
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1">
          <GlobalSearch />
          <div id="dataset-info-toolbar-slot" className="contents" />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="h-10 w-10"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>

          <Button
            ref={menuButtonRef}
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
            className="h-10 w-10 lg:hidden"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileMenu}
    </header>
  )
}
