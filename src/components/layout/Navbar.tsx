import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Map, Layers, Calculator, Wind, BarChart3, Trees, Sun, Moon, ShieldAlert, Building2, X, UtensilsCrossed, Database, ChevronDown, MoreHorizontal } from 'lucide-react'
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
  const moreButtonRef = useRef<HTMLButtonElement>(null)
  const locationParams = new URLSearchParams(location.search)
  const mobileGlassButtonClass = 'border-white/70 bg-white/90 text-zinc-950 shadow-lg backdrop-blur hover:bg-white hover:text-zinc-950 dark:border-zinc-700/70 dark:bg-zinc-950/90 dark:text-zinc-50 dark:shadow-black/50 dark:hover:bg-zinc-900 dark:hover:text-zinc-50'

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
        !menuButtonRef.current?.contains(target) &&
        !moreButtonRef.current?.contains(target)
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
          className="fixed left-3 top-[calc(env(safe-area-inset-top)+3.75rem)] z-[1000] w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur lg:hidden"
        >
          <nav className="flex flex-col p-1.5">
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
    <header className="fixed inset-x-0 top-0 z-[1100] h-0 border-b border-transparent bg-transparent md:relative md:h-14 md:border-border md:bg-background/95 md:backdrop-blur md:supports-[backdrop-filter]:bg-background/60">
      <div
        className="pointer-events-none flex h-12 items-center justify-between gap-2 px-3 pt-1 md:pointer-events-auto md:h-full md:px-4 md:pt-0"
        data-map-mobile-toolbar="true"
      >
        <div className="flex min-w-0 items-center gap-2.5 xl:gap-6">
          <Link to="/" className="hidden shrink-0 items-center gap-2 md:flex">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <Map className="h-4 w-4 text-primary-foreground md:h-5 md:w-5" />
            </div>
            <span className="text-base font-semibold md:text-lg">PGMaps</span>
          </Link>

          <button
            ref={menuButtonRef}
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setMobileMenuOpen(!mobileMenuOpen)
            }}
            aria-label="Main menu"
            aria-haspopup="menu"
            aria-expanded={mobileMenuOpen}
            className={cn(
              'pointer-events-auto flex h-11 shrink-0 items-center gap-1.5 rounded-md border px-3 transition-colors md:hidden',
              mobileGlassButtonClass,
              mobileMenuOpen && 'bg-white dark:bg-zinc-900',
            )}
          >
            <span className="text-[22px] font-bold leading-none tracking-[-0.02em]">PGMaps</span>
            <ChevronDown className={cn('size-3.5 transition-transform', mobileMenuOpen && 'rotate-180')} />
          </button>

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

        <div className="flex items-center gap-2 md:gap-1">
          <GlobalSearch className={cn('pointer-events-auto h-11 w-11 rounded-md md:h-9 md:w-9 md:border-input md:bg-background/80 md:text-muted-foreground md:shadow-none md:backdrop-blur-none md:hover:bg-accent md:hover:text-foreground', mobileGlassButtonClass)} />
          <div id="dataset-info-toolbar-slot" className="contents" />
          <Button
            ref={moreButtonRef}
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className={cn('pointer-events-auto h-11 w-11 rounded-md border md:h-10 md:w-10 md:border-transparent md:bg-transparent md:shadow-none md:backdrop-blur-none md:hover:bg-accent', mobileGlassButtonClass)}
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setMobileMenuOpen(!mobileMenuOpen)
            }}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Toggle menu'}
            aria-expanded={mobileMenuOpen}
            className={cn('pointer-events-auto h-11 w-11 rounded-md border md:hidden', mobileGlassButtonClass)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <MoreHorizontal className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {mobileMenu}
    </header>
  )
}
