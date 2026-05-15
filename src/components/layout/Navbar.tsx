import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Map, Layers, Calculator, Wind, BarChart3, Trees, Sun, Moon, ShieldAlert, Building2, Menu, X, UtensilsCrossed, Database } from 'lucide-react'
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
          className="fixed inset-x-0 top-12 z-[1000] border-b border-border bg-background/95 shadow-lg backdrop-blur md:top-14 lg:hidden"
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
    <header className="relative z-[1100] h-12 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 md:h-14">
      <div className="flex h-full items-center justify-between gap-2 px-2.5 md:px-4">
        <div className="flex min-w-0 items-center gap-2.5 xl:gap-6">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary md:h-8 md:w-8">
              <Map className="h-4 w-4 text-primary-foreground md:h-5 md:w-5" />
            </div>
            <span className="text-base font-semibold md:text-lg">PGMaps</span>
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
            className="h-9 w-9 md:h-10 md:w-10"
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
            className="h-9 w-9 lg:hidden"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileMenu}
    </header>
  )
}
