import { createContext, useContext, useMemo, useState, useEffect, type ReactNode, type CSSProperties } from 'react'
import { resolveWorkspacePresentation } from './responsive.js'
import { useMediaQuery } from './useMediaQuery.js'
import { createMobileCardStack, type MobileCardStackStore } from './mobile-card-store.js'

export * from './workspace-events.js'

export interface WorkspaceContextValue {
  events: EventTarget
  cards: MobileCardStackStore
  theme?: 'light' | 'dark'
  responsive: 'container' | 'viewport'
  breakpoint: number
  isMobile: boolean
  isWide: boolean
  responsiveAttributes: Record<string, 'true' | undefined>
  placement: 'container' | 'viewport'
  root: HTMLElement | null
  setRoot: (root: HTMLElement | null) => void
  toolbar: HTMLElement | null
  onDialogOpenChange?: (open: boolean) => void
}
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)
const targetStores = new WeakMap<EventTarget, MobileCardStackStore>()
function cardsFor(target: EventTarget) {
  let store = targetStores.get(target)
  if (!store) {
    store = createMobileCardStack()
    targetStores.set(target, store)
  }
  return store
}
/** Each workspace owns its events and cards. eventTarget is an explicit host integration escape hatch. */
export function WorkspaceProvider({
  children,
  eventTarget,
  placement = 'container',
  responsive = 'container',
  breakpoint = 768,
  toolbar = null,
  rootElement,
  theme: themeInput,
  className,
  style,
  onDialogOpenChange,
}: {
  children: ReactNode
  theme?: 'light' | 'dark'
  className?: string
  style?: CSSProperties
  /** Host chrome integrations stay outside the generic dialog components. */
  onDialogOpenChange?: (open: boolean) => void
  eventTarget?: EventTarget
  placement?: 'container' | 'viewport'
  /** Measure this workspace by default; full-screen hosts can use the viewport. */
  responsive?: 'container' | 'viewport'
  /** Mobile presentation applies below this width in CSS pixels. */
  breakpoint?: number
  /** Explicit root for host-owned sibling cards or portals. Normally measured automatically. */
  rootElement?: HTMLElement | null
  /** Optional toolbar outside the workspace whose height the sheets should avoid. */
  toolbar?: HTMLElement | null
}) {
  const inherited = useContext(WorkspaceContext)
  const theme = themeInput ?? inherited?.theme ?? 'light'
  const [localTarget] = useState(() => new EventTarget())
  const [root, setRoot] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? breakpoint : window.innerWidth))
  const measuredRoot = rootElement ?? root
  useEffect(() => {
    const measure = () =>
      setWidth(
        responsive === 'viewport'
          ? window.innerWidth
          : (measuredRoot?.getBoundingClientRect().width ?? window.innerWidth),
      )
    if (responsive === 'viewport') {
      window.addEventListener('resize', measure)
      measure()
      return () => window.removeEventListener('resize', measure)
    }
    if (!measuredRoot) return
    const observer = new ResizeObserver(measure)
    observer.observe(measuredRoot)
    return () => observer.disconnect()
  }, [measuredRoot, responsive])
  const { isMobile, isWide, responsiveAttributes } = useMemo(
    () => resolveWorkspacePresentation(width, responsive, breakpoint),
    [width, responsive, breakpoint],
  )
  const events = eventTarget ?? localTarget
  const cards = useMemo(() => cardsFor(events), [events])
  const value = useMemo(
    () => ({
      events,
      cards,
      theme,
      responsive,
      breakpoint,
      isMobile,
      isWide,
      responsiveAttributes,
      placement,
      root: rootElement ?? root,
      setRoot,
      toolbar,
      onDialogOpenChange,
    }),
    [
      events,
      cards,
      theme,
      responsive,
      breakpoint,
      isMobile,
      isWide,
      responsiveAttributes,
      placement,
      root,
      rootElement,
      toolbar,
      onDialogOpenChange,
    ],
  )
  return (
    <WorkspaceContext.Provider value={value}>
      <div
        ref={setRoot}
        className={['geo-toolkit', theme === 'dark' ? 'dark' : '', className].filter(Boolean).join(' ')}
        data-theme={theme}
        data-workspace-responsive={responsive}
        {...responsiveAttributes}
        style={{
          position: 'relative',
          height: '100%',
          width: '100%',
          minHeight: 0,
          ...(responsive === 'container' ? { containerType: 'inline-size', containerName: 'geo-reading' } : {}),
          ...style,
        }}
      >
        {children}
      </div>
    </WorkspaceContext.Provider>
  )
}
export function useWorkspace() {
  return useContext(WorkspaceContext)
}
export function useWorkspaceEvents(): EventTarget | null {
  return useWorkspace()?.events ?? null
}
/** Standalone components get a private bus; a provider shares it within a workspace. */
export function useWorkspaceInteractions(): EventTarget {
  const context = useWorkspace()
  const [fallback] = useState(() => new EventTarget())
  return context?.events ?? fallback
}

/** Responsive attributes for portal roots; standalone dialogs use viewport presentation. */
export function useWorkspacePresentation() {
  const workspace = useWorkspace()
  const mobile = useMediaQuery('(max-width: 767px)')
  const smallDesktop = useMediaQuery('(min-width: 640px)')
  const large = useMediaQuery('(min-width: 1024px)')
  const wide = useMediaQuery('(min-width: 1280px)')
  const fallback = useMemo(
    () => resolveWorkspacePresentation(wide ? 1280 : large ? 1024 : !mobile ? 768 : smallDesktop ? 640 : 0, 'viewport'),
    [mobile, smallDesktop, large, wide],
  )
  return workspace ?? { ...fallback, responsive: 'viewport' as const }
}
