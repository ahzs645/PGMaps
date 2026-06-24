import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Map, Layers, Calculator, Wind, BarChart3, Trees, Sun, Moon, ShieldAlert, Building2, UtensilsCrossed, Database, ChevronDown, ChevronLeft, ChevronRight, RadioTower, PawPrint, Footprints, Droplets, Waves, Bus } from 'lucide-react'
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

const miscTabLinks = [
  { path: '/misc?tab=heatShade', label: 'Heat & Shade', icon: Trees },
  { path: '/misc', label: 'CANUE', icon: Database },
  { path: '/misc?tab=network', label: 'Network', icon: RadioTower },
  { path: '/misc?tab=icbc', label: 'ICBC', icon: ShieldAlert },
  { path: '/misc?tab=wars', label: 'WARS', icon: PawPrint },
  { path: '/misc?tab=walkability', label: 'Walkability', icon: Footprints },
  { path: '/misc?tab=water', label: 'Water', icon: Droplets },
  { path: '/misc?tab=flood', label: 'Flood', icon: Waves },
  { path: '/misc?tab=drought', label: 'Drought', icon: Droplets },
]

const pgDataTabLinks = [
  { path: '/pgdata', label: 'Crime', icon: ShieldAlert },
  { path: '/pgdata?tab=parks', label: 'Parks & Trails', icon: Trees },
  { path: '/pgdata?tab=transit', label: 'Transit', icon: Bus },
]

export function Navbar() {
  const location = useLocation()
  const isHomePage = location.pathname === '/'
  const { resolvedTheme, setTheme } = useTheme()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [mobileSubmenu, setMobileSubmenu] = useState<'pgdata' | 'misc' | null>(null)
  const [mobileToolbarHidden, setMobileToolbarHidden] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
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
    if (path === '/misc') {
      return location.pathname === '/misc'
    }
    return location.pathname === path
  }

  const isMiscTabActive = (path: string) => {
    if (location.pathname !== '/misc') return false
    const params = new URLSearchParams(path.split('?')[1] ?? '')
    return (params.get('tab') ?? 'canue') === (locationParams.get('tab') ?? 'canue')
  }

  const isPgDataTabActive = (path: string) => {
    if (location.pathname !== '/pgdata') return false
    const params = new URLSearchParams(path.split('?')[1] ?? '')
    return (params.get('tab') ?? 'crime') === (locationParams.get('tab') ?? 'crime')
  }

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false)
    setMobileSubmenu(null)
  }, [])

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
        closeMobileMenu()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [closeMobileMenu, mobileMenuOpen])

  useEffect(() => {
    const handleToolbarVisibility = (event: Event) => {
      const hidden = event instanceof CustomEvent && event.detail?.hidden === true
      setMobileToolbarHidden(hidden)
      if (hidden) closeMobileMenu()
    }

    window.addEventListener('pgmaps:mobile-toolbar-visibility', handleToolbarVisibility)
    return () => window.removeEventListener('pgmaps:mobile-toolbar-visibility', handleToolbarVisibility)
  }, [closeMobileMenu])

  const activeMobileSubmenu = mobileSubmenu === 'pgdata'
    ? { label: 'PG Data', links: pgDataTabLinks, isActive: isPgDataTabActive }
    : mobileSubmenu === 'misc'
      ? { label: 'MISC', links: miscTabLinks, isActive: isMiscTabActive }
      : null

  const mobileMenu = mobileMenuOpen && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={menuRef}
          data-testid="mobile-nav-menu"
          className={cn(
            "fixed left-3 top-[calc(env(safe-area-inset-top)+3.75rem)] z-[1000] max-h-[calc(100dvh-env(safe-area-inset-top)-4.75rem)] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover/95 text-popover-foreground shadow-2xl backdrop-blur lg:hidden",
            isHomePage && 'left-8 top-[calc(env(safe-area-inset-top)+4.5rem)] max-h-[calc(100dvh-env(safe-area-inset-top)-5.5rem)]',
          )}
        >
          {activeMobileSubmenu ? (
            <nav className="flex flex-col p-1.5" aria-label={`${activeMobileSubmenu.label} submenu`}>
              <button
                type="button"
                onClick={() => setMobileSubmenu(null)}
                className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-sm font-semibold transition-colors hover:bg-accent hover:text-accent-foreground"
                aria-label="Back to main menu"
              >
                <ChevronLeft className="h-5 w-5" />
                <span className="min-w-0 flex-1">{activeMobileSubmenu.label}</span>
              </button>
              {activeMobileSubmenu.links.map(({ path: tabPath, label: tabLabel, icon: TabIcon }) => (
                <Link
                  key={tabPath}
                  to={tabPath}
                  onClick={closeMobileMenu}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium transition-colors",
                    activeMobileSubmenu.isActive(tabPath)
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <TabIcon className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 truncate">{tabLabel}</span>
                </Link>
              ))}
            </nav>
          ) : (
            <nav className="flex flex-col p-1.5">
              {navLinks.map(({ path, label, icon: Icon }) => (
                path === '/pgdata' || path === '/misc' ? (
                  <button
                    key={path}
                    type="button"
                    onClick={() => setMobileSubmenu(path === '/pgdata' ? 'pgdata' : 'misc')}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-4 py-3 text-left text-sm font-medium transition-colors",
                      isNavActive(path)
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                    aria-haspopup="menu"
                  >
                    <Icon className="h-5 w-5" />
                    <span className="min-w-0 flex-1">{label}</span>
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <Link
                    key={path}
                    to={path}
                    onClick={closeMobileMenu}
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
                )
              ))}
            </nav>
          )}
        </div>,
        document.body,
      )
    : null

  return (
    <header className="fixed inset-x-0 top-0 z-[1100] h-0 border-b border-transparent bg-transparent md:relative md:h-14 md:border-border md:bg-background/95 md:backdrop-blur md:supports-[backdrop-filter]:bg-background/60">
      <div
        className={cn(
          'pointer-events-none flex h-12 items-center justify-between gap-2 px-3 pt-1 md:pointer-events-auto md:h-full md:px-4 md:pt-0',
          isHomePage && 'px-8 pt-4',
          mobileToolbarHidden && !isHomePage && 'hidden md:flex',
        )}
        data-map-mobile-toolbar="true"
      >
        <div className="flex min-w-0 items-center gap-2.5 xl:gap-6">
          <Link to="/" className="hidden shrink-0 items-center gap-2 md:flex">
            <span className="text-base font-semibold md:text-lg">PGMaps</span>
          </Link>

          <button
            ref={menuButtonRef}
            type="button"
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
              if (mobileMenuOpen) {
                closeMobileMenu()
              } else {
                setMobileMenuOpen(true)
              }
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
          <GlobalSearch className={cn('pointer-events-auto h-11 w-11 rounded-md md:h-10 md:w-10 md:border-input md:bg-background/80 md:text-muted-foreground md:shadow-none md:backdrop-blur-none md:hover:bg-accent md:hover:text-foreground', mobileGlassButtonClass)} />
          <div id="dataset-info-toolbar-slot" className="contents" />
          <Button
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
        </div>
      </div>

      {mobileMenu}
    </header>
  )
}
