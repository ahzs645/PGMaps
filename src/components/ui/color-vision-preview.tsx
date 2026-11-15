import { useEffect, useSyncExternalStore } from 'react'
import { Eye } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { StyledSelect } from '@/components/ui/styled-select'
import {
  COLOR_VISION_LABELS,
  COLOR_VISION_MATRICES,
  COLOR_VISION_MODES,
  colorMatrixValues,
  colorVisionFilterId,
  isColorVisionMode,
  type ColorVisionMode,
} from '@/lib/colorVision'

/**
 * The colour-vision preview: the whole page drawn as someone with a colour-vision deficiency would
 * see it, so a map and its legend can be checked together. It lasts for this tab only
 * (sessionStorage), because a simulation left on by mistake on the next visit would look like
 * broken colours. Choose it from any map's right-click menu or the Appearance dialog.
 */

const STORAGE_KEY = 'pgmaps.colorVisionPreview'
const listeners = new Set<() => void>()
let current: ColorVisionMode | null = readStored()

function readStored(): ColorVisionMode | null {
  try {
    const value = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(STORAGE_KEY)
    return isColorVisionMode(value) ? value : null
  } catch {
    return null
  }
}

export function setColorVisionPreview(mode: ColorVisionMode | null) {
  if (mode === current) return
  current = mode
  try {
    if (mode) sessionStorage.setItem(STORAGE_KEY, mode)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable: the preview lasts until the page reloads.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The mode being previewed, or null. */
export function useColorVisionPreview(): ColorVisionMode | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  )
}

/**
 * Mount once at the application root. It holds the SVG filters, applies the chosen one to the
 * root element (a filter there does not become the containing block of fixed elements, so
 * dialogs and sheets stay where they are), and shows a notice with a way out while it is on.
 */
export function ColorVisionPreview() {
  const mode = useColorVisionPreview()

  useEffect(() => {
    const root = document.documentElement
    if (!mode) return
    root.style.filter = `url(#${colorVisionFilterId(mode)})`
    root.dataset.colorVisionPreview = mode
    return () => {
      root.style.filter = ''
      delete root.dataset.colorVisionPreview
    }
  }, [mode])

  return (
    <>
      <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          {COLOR_VISION_MODES.map((item) => (
            <filter key={item} id={colorVisionFilterId(item)} colorInterpolationFilters="linearRGB">
              <feColorMatrix type="matrix" values={colorMatrixValues(COLOR_VISION_MATRICES[item])} />
            </filter>
          ))}
        </defs>
      </svg>
      {mode && (
        <div
          role="status"
          data-testid="color-vision-notice"
          className="fixed bottom-16 left-1/2 z-[1300] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-background/95 py-1 pl-3 pr-1 text-xs shadow-md backdrop-blur"
        >
          <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">
            Previewing <strong className="font-semibold">{COLOR_VISION_LABELS[mode].label.toLowerCase()}</strong>
          </span>
          <Button size="2xs" variant="outline" className="rounded-full" onClick={() => setColorVisionPreview(null)}>
            Turn off
          </Button>
        </div>
      )}
    </>
  )
}

/** A dropdown for the preview, for settings dialogs. */
export function ColorVisionSelect({ id, className }: { id?: string; className?: string }) {
  const mode = useColorVisionPreview()
  return (
    <StyledSelect
      id={id}
      className={className}
      aria-label="Colour-vision preview"
      value={mode ?? ''}
      onChange={(event) => setColorVisionPreview(isColorVisionMode(event.target.value) ? event.target.value : null)}
    >
      <option value="">Off</option>
      {COLOR_VISION_MODES.map((item) => (
        <option key={item} value={item}>
          {COLOR_VISION_LABELS[item].label}
        </option>
      ))}
    </StyledSelect>
  )
}
