import { X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MOTION_DURATION, MOTION_EASING, useMotionPresence, useReducedMotion } from '@pgmaps/geo-toolkit/ui/motion'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { RefObject } from 'react'
import { cn } from '@/lib/utils'
import { SearchInput } from '@/components/ui/map-panels'
import { neighbourhoodFeatures, parkFeatures, routeFeatures } from './data'
import { featureMatchesYearRange, layerLabel } from './geo'
import type { InteractFeature, LayerId, YearRange } from './types'

const layerOrder: LayerId[] = ['neighbourhoods', 'parks', 'routes']

const layerGlyphs: Record<LayerId, { color: string; shape: 'circle' | 'square' | 'line' }> = {
  neighbourhoods: { color: '#8b5cf6', shape: 'square' },
  parks: { color: '#22c55e', shape: 'square' },
  routes: { color: '#0ea5e9', shape: 'line' },
}

export function MapSearchSheet({
  open,
  hiddenFeatureIds,
  isolatedFeatureId,
  yearRange,
  onClose,
  onExited,
  onSelect,
}: {
  open: boolean
  hiddenFeatureIds: Set<string>
  isolatedFeatureId: string | null
  yearRange: YearRange
  onClose: () => void
  onExited: () => void
  onSelect: (feature: InteractFeature) => void
}) {
  const [query, setQuery] = useState('')
  const isMobile = useIsMobile()
  const reducedMotion = useReducedMotion()
  const presence = useMotionPresence(open)
  const inputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  const exitNotifiedRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const onExitedRef = useRef(onExited)
  const titleId = useId()

  useLayoutEffect(() => {
    onCloseRef.current = onClose
    onExitedRef.current = onExited
  }, [onClose, onExited])

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current
    if (opener?.isConnected && !opener.closest('[inert]') && opener.getClientRects().length) {
      opener.focus({ preventScroll: true })
    } else if (dialogRef.current?.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  }, [])

  const requestClose = useCallback(() => {
    if (dialogRef.current?.contains(document.activeElement)) restoreFocus()
    onCloseRef.current()
  }, [restoreFocus])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (open) {
      if (!wasOpenRef.current) {
        openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      }
      if (dialog) dialog.inert = false
      // StrictMode replays the unmount cleanup, which restores the opener.
      // Re-focus on setup even when the logical open state did not change.
      inputRef.current?.focus({ preventScroll: true })
    } else {
      if (dialog?.contains(document.activeElement)) restoreFocus()
      if (dialog) dialog.inert = true
    }
    wasOpenRef.current = open
  }, [open, presence.present, restoreFocus])

  useLayoutEffect(() => {
    if (open) exitNotifiedRef.current = false
    else if (!presence.present && !exitNotifiedRef.current) {
      exitNotifiedRef.current = true
      onExitedRef.current()
    }
  }, [open, presence.present])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      requestClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, requestClose])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    return () => {
      if (dialog?.contains(document.activeElement)) restoreFocus()
    }
  }, [presence.present, restoreFocus])

  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return [...neighbourhoodFeatures.features, ...parkFeatures.features, ...routeFeatures.features].filter(
      (feature) => {
        if (hiddenFeatureIds.has(feature.properties.id)) return false
        if (isolatedFeatureId && feature.properties.id !== isolatedFeatureId) return false
        if (!featureMatchesYearRange(feature, yearRange)) return false
        if (!normalizedQuery) return true

        const searchable = [
          feature.properties.name,
          feature.properties.description,
          feature.properties.value,
          layerLabel(feature.properties.layer),
          ...feature.properties.properties.flatMap((property) => [property.label, property.value]),
        ]
          .join(' ')
          .toLowerCase()

        return searchable.includes(normalizedQuery)
      },
    )
  }, [hiddenFeatureIds, isolatedFeatureId, query, yearRange])

  const groupedRows = useMemo(() => {
    return layerOrder
      .map((layer) => ({
        layer,
        rows: rows.filter((feature) => feature.properties.layer === layer),
      }))
      .filter((group) => group.rows.length > 0)
  }, [rows])

  const selectFeature = (feature: InteractFeature) => {
    onSelect(feature)
    requestClose()
  }

  if (!presence.present) return null

  return (
    <>
      {isMobile && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={!open}
          className={cn('fixed inset-0 z-[1200] bg-black/55', !open && 'pointer-events-none')}
          style={{
            opacity: presence.visible ? 1 : 0,
            transition: reducedMotion ? 'none' : `opacity ${MOTION_DURATION.panel}ms ${MOTION_EASING}`,
          }}
          onClick={requestClose}
        />
      )}
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby={titleId}
        aria-modal={isMobile}
        data-open={open}
        className={cn(
          'flex flex-col overflow-hidden border border-border bg-background',
          isMobile
            ? 'fixed inset-x-0 bottom-0 z-[1210] h-[calc(100dvh-4.75rem)] rounded-t-lg border-b-0 shadow-[0_-2px_16px_rgba(0,0,0,0.24)]'
            : 'absolute right-4 top-16 z-[70] h-[min(520px,calc(100%-5rem))] w-[min(420px,calc(100%-2rem))] rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.18)]',
          !open && 'pointer-events-none',
        )}
        style={{
          transform: presence.visible
            ? 'translateY(0)'
            : isMobile
              ? 'translateY(calc(100% + 2rem))'
              : 'translateY(8px)',
          opacity: isMobile || presence.visible ? 1 : 0,
          transition: reducedMotion
            ? 'none'
            : `transform ${MOTION_DURATION.panel}ms ${MOTION_EASING}, opacity ${MOTION_DURATION.panel}ms ${MOTION_EASING}`,
        }}
        onKeyDown={(event) => {
          if (!isMobile || event.key !== 'Tab') return
          const focusable = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled]), [tabindex="0"]',
            ),
          ].filter((element) => !element.closest('[inert]') && element.getClientRects().length)
          const first = focusable[0]
          const last = focusable.at(-1)
          if (event.shiftKey && document.activeElement === first && last) {
            event.preventDefault()
            last.focus({ preventScroll: true })
          } else if (!event.shiftKey && document.activeElement === last && first) {
            event.preventDefault()
            first.focus({ preventScroll: true })
          }
        }}
      >
        <SearchHeader titleId={titleId} onClose={requestClose} compact={!isMobile} />
        <SearchBody
          query={query}
          groupedRows={groupedRows}
          inputRef={inputRef}
          onQueryChange={setQuery}
          onSelect={selectFeature}
          mobilePrimary={isMobile}
        />
      </div>
    </>
  )
}

function SearchHeader({
  titleId,
  onClose,
  compact = false,
}: {
  titleId: string
  onClose: () => void
  compact?: boolean
}) {
  return (
    <div className="shrink-0 border-b border-border">
      {!compact && (
        <div className="flex justify-center py-2 md:hidden" aria-hidden="true">
          <div className="flex">
            <span className="h-1 w-[18px] translate-x-0.5 rounded-full bg-muted-foreground/25" />
            <span className="h-1 w-[18px] -translate-x-0.5 rounded-full bg-muted-foreground/25" />
          </div>
        </div>
      )}
      <header className={cn('flex items-center justify-between gap-3 px-4 pb-3 pt-1', compact && 'py-3')}>
        <div className="min-w-0">
          <p id={titleId} className="truncate text-base font-semibold">
            Search locations
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">Find visible map features</p>
        </div>
        <button type="button" className="rounded-md p-2 hover:bg-muted" onClick={onClose} aria-label="Close search">
          <X className="size-4" />
        </button>
      </header>
    </div>
  )
}

function SearchBody({
  query,
  groupedRows,
  inputRef,
  onQueryChange,
  onSelect,
  mobilePrimary = false,
}: {
  query: string
  groupedRows: Array<{ layer: LayerId; rows: InteractFeature[] }>
  inputRef: RefObject<HTMLInputElement>
  onQueryChange: (query: string) => void
  onSelect: (feature: InteractFeature) => void
  mobilePrimary?: boolean
}) {
  const resultCount = groupedRows.reduce((total, group) => total + group.rows.length, 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('shrink-0 border-b border-border p-3', mobilePrimary && 'border-b-0 px-3 pb-2 pt-3')}>
        <SearchInput
          ref={inputRef}
          icon
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onClear={() => onQueryChange('')}
          placeholder="Search map items..."
          aria-label="Search map items"
          // Opened by its own button; keep the page search shortcut on the sidebar field.
          data-map-search-input="false"
          className={cn(
            'h-10 rounded-md border-border',
            mobilePrimary && 'border-rose-300 shadow-sm focus:ring-rose-300',
          )}
        />
      </div>

      <div className={cn('min-h-0 flex-1 overflow-y-auto py-2', mobilePrimary && 'pt-1')}>
        {groupedRows.map((group) => (
          <div key={group.layer} className="pb-2">
            <div
              className={cn(
                'px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                mobilePrimary && 'px-3',
              )}
            >
              {layerLabel(group.layer)}
            </div>
            {group.rows.map((feature) => (
              <button
                key={feature.properties.id}
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted',
                  mobilePrimary && 'px-3',
                )}
                onClick={() => onSelect(feature)}
              >
                <LayerGlyph layer={feature.properties.layer} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-foreground">{feature.properties.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{feature.properties.description}</div>
                </div>
              </button>
            ))}
          </div>
        ))}
        {resultCount === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No map items match that search.</div>
        )}
      </div>

      <div className="shrink-0 border-t border-border px-4 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-xs text-muted-foreground">
        {resultCount} result{resultCount === 1 ? '' : 's'}
      </div>
    </div>
  )
}

function LayerGlyph({ layer }: { layer: LayerId }) {
  const glyph = layerGlyphs[layer]
  if (glyph.shape === 'line') {
    return (
      <span className="h-0.5 w-5 shrink-0 rounded-full" style={{ backgroundColor: glyph.color }} aria-hidden="true" />
    )
  }
  if (glyph.shape === 'circle') {
    return (
      <span
        className="size-4 shrink-0 rounded-full border-2 border-white shadow-sm"
        style={{ backgroundColor: glyph.color }}
        aria-hidden="true"
      />
    )
  }
  return (
    <span
      className="size-4 shrink-0 rounded-sm border border-black/10"
      style={{ backgroundColor: glyph.color, opacity: 0.8 }}
      aria-hidden="true"
    />
  )
}
