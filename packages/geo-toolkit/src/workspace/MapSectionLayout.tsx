import { useCallback, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '../utils.js'
import { MAP_OVERLAY_ROOT_STYLE } from '../ui/map-overlay.js'
import { WorkspaceProvider, useWorkspace } from './workspace-context.js'
import { useMobileSheetController } from './useMobileSheetController.js'
import { SidebarResizeHandle } from './SidebarResizeHandle.js'
import { MOBILE_COLLAPSED_VISIBLE_HEIGHT, type MobileSheetState } from './sheet-math.js'
export { DESKTOP_SIDEBAR_MIN_WIDTH, DESKTOP_SIDEBAR_MAX_WIDTH } from './SidebarResizeHandle.js'

/**
 * Classes a section's sidebar element needs to sit correctly inside this
 * layout: full-bleed in the mobile sheet, bordered and raised on desktop.
 * Pass it as the sidebar's own `className` — it cannot live on a wrapper
 * because sidebars merge it into their root element.
 */
export const MAP_SIDEBAR_CLASS =
  'h-full w-full border-0 shadow-none workspace-desktop:border-r workspace-desktop:shadow-xl'

export interface MapSectionLayoutProps {
  sidebar: ReactNode
  /**
   * Omit both this and `onToggleDesktopSidebar` to let the layout own the
   * open/closed state (starting open) — most sections have no reason to.
   * Pass both to control it, e.g. to collapse the sidebar from elsewhere.
   */
  showDesktopSidebar?: boolean
  onToggleDesktopSidebar?: () => void
  desktopSidebarWidth?: number
  mobileInitialSheetState?: MobileSheetState
  /** Full control over the collapsed-sheet peek. Prefer the title/subtitle props below. */
  mobilePeek?: ReactNode
  /** Renders the standard two-line peek. Ignored when `mobilePeek` is set. */
  mobilePeekTitle?: ReactNode
  mobilePeekSubtitle?: ReactNode
  selectedFeatureMobilePeek?: {
    title?: string
    subtitle?: string
  }
  showMobilePeek?: boolean
  /** Hides the collapsed-sheet chevron toggle; the drag handle still resizes. */
  showMobileSheetChevron?: boolean
  mobileSidebar?: ReactNode
  mobileSnapTo?: MobileSheetState
  mobileSnapVisibleHeight?: number
  mobileSnapFromVisibleHeight?: number
  mobileSnapKey?: string | number
  mobileSheetInteractive?: boolean
  mobileScrimEnabled?: boolean
  mobileSheetContentClassName?: string
  mobileCollapsedVisibleHeight?: number
  onMobileSheetStateChange?: (state: MobileSheetState) => void
  /** When set, renders a drag handle on the sidebar's inner edge for resizing. */
  onDesktopSidebarWidthChange?: (width: number) => void
  rightSidebar?: ReactNode
  showDesktopRightSidebar?: boolean
  onToggleDesktopRightSidebar?: () => void
  desktopRightSidebarWidth?: number
  /** When set, renders a drag handle on the right sidebar's inner edge for resizing. */
  onDesktopRightSidebarWidthChange?: (width: number) => void
  suppressMobileSheet?: boolean
  /** Hides the left sidebar entirely (and its toggle / mobile bottom sheet). */
  disableSidebar?: boolean
  /**
   * Docked pane rendered across the full width below the map *and* the sidebars,
   * taking real layout height so everything above it is shortened rather than
   * overlaid. Used for the Felt-style data table.
   */
  bottomPane?: ReactNode
  /**
   * Height of `bottomPane` in px, reserved above the layout row on desktop.
   * Must be px, not a percentage — percentage padding resolves against width.
   */
  bottomPaneHeight?: number
  children: ReactNode
  className?: string
}

function MapSectionLayoutInner({
  sidebar,
  showDesktopSidebar: showDesktopSidebarProp,
  onToggleDesktopSidebar: onToggleDesktopSidebarProp,
  desktopSidebarWidth = 350,
  mobileInitialSheetState = 'collapsed',
  mobilePeek,
  mobilePeekTitle,
  mobilePeekSubtitle,
  selectedFeatureMobilePeek,
  // A supplied peek is meant to be seen; sections only need the flag to hide one conditionally.
  showMobilePeek = mobilePeek != null || mobilePeekTitle != null || mobilePeekSubtitle != null,
  showMobileSheetChevron = true,
  mobileSidebar,
  mobileSnapTo,
  mobileSnapVisibleHeight,
  mobileSnapFromVisibleHeight,
  mobileSnapKey,
  mobileSheetInteractive = true,
  mobileScrimEnabled = true,
  mobileSheetContentClassName,
  mobileCollapsedVisibleHeight = MOBILE_COLLAPSED_VISIBLE_HEIGHT,
  onMobileSheetStateChange,
  onDesktopSidebarWidthChange,
  rightSidebar,
  showDesktopRightSidebar = true,
  onToggleDesktopRightSidebar,
  desktopRightSidebarWidth = 360,
  onDesktopRightSidebarWidthChange,
  suppressMobileSheet = false,
  disableSidebar = false,
  bottomPane,
  bottomPaneHeight = 0,
  children,
  className,
}: MapSectionLayoutProps) {
  // Uncontrolled by default: every section used to repeat the same
  // useState(true) + toggle purely to satisfy these two props.
  const [uncontrolledSidebarOpen, setUncontrolledSidebarOpen] = useState(true)
  const showDesktopSidebar = showDesktopSidebarProp ?? uncontrolledSidebarOpen
  const toggleUncontrolledSidebar = useCallback(() => setUncontrolledSidebarOpen((open) => !open), [])
  const onToggleDesktopSidebar = onToggleDesktopSidebarProp ?? toggleUncontrolledSidebar

  const {
    rootRef,
    sheetRef,
    handleRef,
    contentRef,
    scrimRef,
    rightSidebarRef,
    mobileSheetState,
    mobileControlsInFront,
    mobileFeatureCardOpen,
    mobileFeaturePeek,
    bringFeatureCardToFront,
    bringControlsToFront,
    snapTo,
    handleScrimClick,
    handleMobileSheetKeyDown,
    startHandlePointerDrag,
    moveHandlePointerDrag,
    endHandlePointerDrag,
  } = useMobileSheetController({
    mobileInitialSheetState,
    mobileCollapsedVisibleHeight,
    mobileSheetInteractive,
    mobileScrimEnabled,
    onMobileSheetStateChange,
    disableSidebar,
    suppressMobileSheet,
    showDesktopRightSidebar,
    onToggleDesktopRightSidebar,
    mobileSnapVisibleHeight,
    mobileSnapFromVisibleHeight,
    mobileSnapKey,
    mobileSnapTo,
    showDesktopSidebar,
    onToggleDesktopSidebar,
  })

  // ─── Render ──────────────────────────────────────────────────────────────

  const renderedMobilePeek =
    mobileControlsInFront && mobileFeatureCardOpen ? (
      <button
        type="button"
        className="min-w-0 text-left"
        data-map-mobile-sheet-peek-action="true"
        aria-label="Show selected feature card"
        onClick={(event) => {
          event.stopPropagation()
          bringFeatureCardToFront()
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        <span className="block truncate text-xs font-semibold text-foreground">
          {mobileFeaturePeek.title || selectedFeatureMobilePeek?.title || 'Selected feature'}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {mobileFeaturePeek.subtitle || selectedFeatureMobilePeek?.subtitle || 'Tap to show selected feature'}
        </span>
      </button>
    ) : (
      (mobilePeek ??
      (mobilePeekTitle || mobilePeekSubtitle ? (
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">{mobilePeekTitle}</div>
          <div className="truncate text-xs text-muted-foreground">{mobilePeekSubtitle}</div>
        </div>
      ) : undefined))
    )

  return (
    <div
      ref={rootRef}
      data-map-layout-root="true"
      className={cn(
        'relative flex h-full w-full overflow-clip bg-slate-100 dark:bg-slate-950',
        // Padding (not a wrapper element) keeps the existing flex row untouched
        // for every page that does not use a bottom pane. Desktop only — the
        // mobile table renders as a sheet instead.
        bottomPane && 'workspace-desktop:pb-[var(--map-bottom-pane-height)]',
        className,
      )}
      style={
        {
          ...MAP_OVERLAY_ROOT_STYLE,
          ...(bottomPane ? { '--map-bottom-pane-height': `${bottomPaneHeight}px` } : {}),
        } as CSSProperties
      }
    >
      {/* Sidebar wrapper */}
      {!disableSidebar && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 workspace-desktop:pointer-events-auto workspace-desktop:relative workspace-desktop:inset-auto workspace-desktop:z-10 workspace-desktop:h-full workspace-desktop:shrink-0',
            mobileControlsInFront ? 'z-[60]' : 'z-30',
            suppressMobileSheet && 'hidden workspace-desktop:block',
            showDesktopSidebar
              ? 'workspace-desktop:block workspace-desktop:w-[clamp(17.5rem,34vw,var(--desktop-sidebar-width))] workspace-wide:w-[var(--desktop-sidebar-width)]'
              : 'workspace-desktop:hidden',
          )}
          style={{ '--desktop-sidebar-width': `${desktopSidebarWidth}px` } as CSSProperties}
          data-map-sidebar-wrapper="true"
        >
          {/* Scrim / backdrop */}
          <div
            ref={scrimRef}
            className="absolute inset-0 bg-black workspace-desktop:hidden"
            style={{ opacity: 0, pointerEvents: 'none' }}
            onClick={handleScrimClick}
            aria-hidden="true"
          />

          {/* Bottom sheet */}
          <div
            ref={sheetRef}
            className={cn(
              'absolute inset-x-0 bottom-0 flex h-full max-h-full flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)]',
              mobileSheetInteractive || mobileControlsInFront || mobileFeatureCardOpen
                ? 'pointer-events-auto'
                : 'pointer-events-none',
              'workspace-desktop:relative workspace-desktop:inset-auto workspace-desktop:h-full workspace-desktop:rounded-none workspace-desktop:border-0 workspace-desktop:bg-transparent workspace-desktop:shadow-none workspace-desktop:backdrop-blur-none',
            )}
            data-map-mobile-sheet="true"
            onClickCapture={(event) => {
              if (!mobileFeatureCardOpen || mobileControlsInFront) return
              event.preventDefault()
              event.stopPropagation()
              bringControlsToFront()
            }}
          >
            {/* Drag handle */}
            <div
              ref={handleRef}
              // Keyboard focus lights up the grip pill rather than boxing the whole strip in a ring.
              className="group relative flex shrink-0 cursor-grab touch-none flex-col select-none rounded-t-lg active:cursor-grabbing focus-visible:outline-none workspace-desktop:hidden"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Drag to resize sheet"
              aria-valuemin={0}
              aria-valuemax={2}
              aria-valuenow={mobileSheetState === 'collapsed' ? 0 : mobileSheetState === 'half' ? 1 : 2}
              aria-valuetext={`${mobileSheetState} panel`}
              tabIndex={0}
              data-map-mobile-sheet-handle="true"
              onKeyDown={handleMobileSheetKeyDown}
              onPointerDown={startHandlePointerDrag}
              onPointerMove={moveHandlePointerDrag}
              onPointerUp={endHandlePointerDrag}
              onPointerCancel={endHandlePointerDrag}
              onClick={(event) => {
                if (!mobileFeatureCardOpen || mobileControlsInFront) return
                event.stopPropagation()
                bringControlsToFront()
              }}
            >
              <div className="flex justify-center py-2" aria-hidden="true">
                <div className="h-1 w-10 rounded-full bg-muted-foreground/30 transition-[width,background-color] group-focus-visible:w-16 group-focus-visible:bg-cyan-500" />
              </div>
              {((showMobilePeek && mobileSheetState === 'collapsed') ||
                (mobileFeatureCardOpen && mobileControlsInFront)) && (
                <div
                  className={cn(
                    'min-h-0 w-full px-4 pb-3',
                    showMobileSheetChevron && 'pr-14',
                    renderedMobilePeek && 'border-b border-border',
                  )}
                >
                  {renderedMobilePeek ?? <div className="h-8" aria-hidden="true" />}
                </div>
              )}
              {showMobileSheetChevron && (
                <button
                  type="button"
                  // Its own tap, not the start of a handle drag: the handle's
                  // pointer capture otherwise swallowed the click.
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation()
                    snapTo(mobileSheetState === 'collapsed' ? 'half' : 'collapsed')
                  }}
                  className="absolute right-2 top-1 z-10 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring workspace-sm:right-3"
                  aria-label={mobileSheetState === 'collapsed' ? 'Show panel' : 'Hide panel'}
                >
                  {mobileSheetState === 'collapsed' ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>

            {/* Sidebar content. A fixed-height slot that does not scroll: a
              sidebar owns its own scroll container, so anything a section
              stacks beside its shell here is clipped rather than scrolled. */}
            <div
              ref={contentRef}
              className={cn(
                'min-h-0 flex-1 overflow-hidden overscroll-y-contain pb-[calc(env(safe-area-inset-bottom)+4rem)] transition-opacity duration-200 workspace-desktop:h-full workspace-desktop:!touch-auto workspace-desktop:pb-0 workspace-desktop:opacity-100',
                mobileSheetContentClassName,
                mobileSheetState === 'full' ? 'touch-auto' : 'touch-none',
                // The peek is the collapsed sheet's whole face; the panel's own header must not show under it.
                showMobilePeek && mobileSheetState === 'collapsed' && 'opacity-0',
              )}
              data-map-mobile-sheet-content="true"
            >
              {mobileSidebar ? (
                <>
                  <div className="h-full workspace-desktop:hidden">{mobileSidebar}</div>
                  <div className="hidden h-full workspace-desktop:block">{sidebar}</div>
                </>
              ) : (
                sidebar
              )}
            </div>
          </div>

          {onDesktopSidebarWidthChange && showDesktopSidebar && (
            <SidebarResizeHandle side="left" width={desktopSidebarWidth} onWidthChange={onDesktopSidebarWidthChange} />
          )}
        </div>
      )}

      {/* Desktop left-sidebar toggle */}
      {!disableSidebar && (
        <button
          type="button"
          onClick={onToggleDesktopSidebar}
          aria-label={showDesktopSidebar ? 'Hide sidebar' : 'Show sidebar'}
          style={{ left: showDesktopSidebar ? `clamp(17.5rem, 34vw, ${desktopSidebarWidth}px)` : 0 }}
          className="absolute top-1/2 z-20 hidden h-16 w-8 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 border-slate-300/80 bg-background/95 text-slate-600 shadow-sm backdrop-blur transition-[left,background-color,color,border-color] hover:bg-muted dark:border-slate-700 dark:text-slate-200 workspace-desktop:flex"
        >
          {showDesktopSidebar ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>
      )}

      {/* Map content */}
      <div className="relative min-w-0 flex-1 overflow-hidden" data-map-content="true">
        {children}
      </div>

      {/* Right sidebar (desktop only) */}
      {rightSidebar && (
        <>
          <div
            ref={rightSidebarRef}
            className={cn(
              'hidden workspace-desktop:block workspace-desktop:absolute workspace-desktop:right-0 workspace-desktop:top-0 workspace-desktop:z-30 workspace-desktop:h-full workspace-desktop:shrink-0 workspace-desktop:overflow-visible workspace-large:relative workspace-large:z-10',
              showDesktopRightSidebar
                ? 'workspace-desktop:w-[var(--desktop-right-sidebar-width)]'
                : 'workspace-desktop:w-0',
            )}
            style={{ '--desktop-right-sidebar-width': `${desktopRightSidebarWidth}px` } as CSSProperties}
            data-map-right-sidebar="true"
          >
            <div className={cn('relative h-full overflow-visible', showDesktopRightSidebar ? 'w-full' : 'w-0')}>
              {showDesktopRightSidebar && (
                <>
                  {onToggleDesktopRightSidebar && (
                    <button
                      type="button"
                      onClick={onToggleDesktopRightSidebar}
                      aria-label="Hide right sidebar"
                      className="absolute left-0 top-1/2 z-20 hidden h-16 w-8 -translate-x-full -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-slate-300/80 bg-background/95 text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-muted dark:border-slate-700 dark:text-slate-200 workspace-desktop:flex"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </button>
                  )}
                  <div className="h-full w-full">{rightSidebar}</div>
                  {onDesktopRightSidebarWidthChange && (
                    <SidebarResizeHandle
                      side="right"
                      width={desktopRightSidebarWidth}
                      onWidthChange={onDesktopRightSidebarWidthChange}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {onToggleDesktopRightSidebar && !showDesktopRightSidebar && (
            <button
              type="button"
              onClick={onToggleDesktopRightSidebar}
              aria-label="Show right sidebar"
              style={{ right: 0 }}
              className="absolute top-1/2 z-20 hidden h-16 w-8 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-slate-300/80 bg-background/95 text-slate-600 shadow-sm backdrop-blur transition-[right,background-color,color,border-color] hover:bg-muted dark:border-slate-700 dark:text-slate-200 workspace-desktop:flex"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          )}
        </>
      )}

      {/* Docked bottom pane — spans the full root width, under the sidebars too. */}
      {bottomPane}
    </div>
  )
}

/** Automatically scopes a layout unless the host supplied a WorkspaceProvider. */
export function MapSectionLayout(props: MapSectionLayoutProps) {
  const workspace = useWorkspace()
  return workspace ? (
    <MapSectionLayoutInner {...props} />
  ) : (
    <WorkspaceProvider>
      <MapSectionLayoutInner {...props} />
    </WorkspaceProvider>
  )
}
