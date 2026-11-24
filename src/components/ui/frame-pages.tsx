/**
 * Pages laid out as HTML (a Word file's pages, a workbook's sheets, a report or plot book written as a web page, a
 * draft) in the same viewer as every other file preview (`docs/shared-ui.md`, **File previews**): the shared bar over
 * it (zoom, *Open in a new tab*) and the viewers' gestures inside the frame. A pinch or Ctrl/⌘ + wheel zooms about the
 * pointer, a plain wheel scrolls the pages, and `+`, `-` and `0` work while the frame or its bar has focus.
 *
 * The frame runs no scripts (`sandbox` without `allow-scripts`); same-origin lets the viewer zoom its document and
 * listen for its gestures, and lets the page that shows it listen for clicks (`onFrameLoad`). Fitted, a document
 * wider than the frame (the plot book's A3, a Word page in a narrow pane) is scaled down to its width, as a print
 * preview does; a narrower one keeps its own size. A zoom the reader chose is kept when the same output is laid out
 * again, and only a new `resetKey` fits it again.
 *
 * A document is drawn on white paper whatever the theme. A screen page (`page="screen"`, `src/lib/screenPage.ts`), the
 * HTML a preview writes to describe a file it cannot show, is given the app's own colours instead, again whenever the
 * theme changes, so it reads as part of the dialog in dark mode.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowLeftRight } from 'lucide-react'

import { isDarkToken, SCREEN_PAGE_TOKENS, screenColourProperty, type ScreenPageColour } from '@/lib/screenPage'
import { cn } from '@/lib/utils'

import { OpenInTabButton, useOpenInTab, ViewerToolbar, ViewerZoom } from './viewer-toolbar'
import { listenZoomGestures, zoomKey, type ZoomPoint } from './zoomGestures'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const STEP = 1.25

/** The zoom that shows a document whole across its frame: below 1 only for a document wider than the frame. */
function fittedZoom(doc: Document): number {
  const root = doc.documentElement
  const held = root.style.getPropertyValue('zoom')
  root.style.removeProperty('zoom')
  const room = root.clientWidth,
    wide = root.scrollWidth
  if (held) root.style.setProperty('zoom', held)
  return room > 0 && wide > room + 1 ? room / wide : 1
}

function setZoom(doc: Document, zoom: number) {
  const root = doc.documentElement
  if (Math.abs(zoom - 1) < 1e-3) root.style.removeProperty('zoom')
  else root.style.setProperty('zoom', String(zoom))
}

/** Gives a screen page the theme the frame sits in: each colour from the app's token where the frame is. */
function applyScreenTheme(element: HTMLIFrameElement, doc: Document) {
  const host = getComputedStyle(element)
  const root = doc.documentElement
  for (const name of Object.keys(SCREEN_PAGE_TOKENS) as ScreenPageColour[]) {
    const value = host.getPropertyValue(`--${SCREEN_PAGE_TOKENS[name]}`).trim()
    if (value) root.style.setProperty(screenColourProperty(name), `hsl(${value})`)
    else root.style.removeProperty(screenColourProperty(name))
  }
  root.style.setProperty('color-scheme', isDarkToken(host.getPropertyValue('--background')) ? 'dark' : 'light')
}

export type FramePagesProps = {
  html: string
  /** What is shown: the frame's title is "<title> preview". */
  title: string
  /** Told the frame once its document is loaded and zoomed, to listen for clicks or find its place. */
  onFrameLoad?: (frame: HTMLIFrameElement) => void
  /** Told the frame element as it mounts and unmounts, for a page that reaches its document later. */
  frameRef?: (element: HTMLIFrameElement | null) => void
  /** What *Open in a new tab* opens; by default the HTML itself. */
  open?: Blob | string | (() => Blob | string)
  /** Left of the bar: a caption or a hint. */
  toolbarStart?: ReactNode
  /** A change fits the pages again (another output); a rebuild of the same output keeps the reader's zoom. */
  resetKey?: string | number | null
  className?: string
  /** The frame's own name, where it is not "<title> preview". */
  frameTitle?: string
  /**
   * `document` (the default): the file itself, on white paper. `screen`: a page describing a file, drawn in the app's
   * theme through `screenColour` (`src/lib/screenPage.ts`).
   */
  page?: 'document' | 'screen'
}

export function FramePages({
  html,
  title,
  onFrameLoad,
  frameRef,
  open,
  toolbarStart,
  resetKey = null,
  className,
  frameTitle,
  page = 'document',
}: FramePagesProps) {
  const frame = useRef<HTMLIFrameElement | null>(null)
  // `null` fits the pages to the frame; a number is a zoom the reader chose.
  const [chosen, setChosen] = useState<number | null>(null)
  const [fit, setFit] = useState<number | null>(null)
  const chosenRef = useRef<number | null>(null)
  const fitRef = useRef(1)
  const [shownFor, setShownFor] = useState(resetKey)
  if (shownFor !== resetKey) {
    setShownFor(resetKey)
    setChosen(null)
  }
  useEffect(() => {
    chosenRef.current = chosen
  }, [chosen])
  const latestLoad = useRef(onFrameLoad)
  useEffect(() => {
    latestLoad.current = onFrameLoad
  })
  const openInTab = useOpenInTab()

  /** Zooms the document now, keeping the point `at` (in the frame's own viewport) where it is. */
  const zoomTo = (next: number | null, at?: ZoomPoint) => {
    const doc = frame.current?.contentDocument
    const win = frame.current?.contentWindow
    const target = next === null ? null : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
    chosenRef.current = target
    setChosen(target)
    if (!doc || !win) return
    const before = Number(doc.documentElement.style.getPropertyValue('zoom')) || 1
    const after = target ?? fitRef.current
    const x = at ? at.clientX : win.innerWidth / 2,
      y = at ? at.clientY : 0
    const left = win.scrollX,
      top = win.scrollY
    setZoom(doc, after)
    const ratio = after / before
    win.scrollTo((left + x) * ratio - x, (top + y) * ratio - y)
  }
  const latestZoom = useRef(zoomTo)
  useEffect(() => {
    latestZoom.current = zoomTo
  })
  const step = (factor: number) => zoomTo((chosenRef.current ?? fitRef.current) * factor)
  const onKey = (
    event: Pick<KeyboardEvent['nativeEvent'], 'key' | 'altKey' | 'target'> & { preventDefault(): void },
  ) => {
    const asked = zoomKey(event)
    if (!asked) return
    event.preventDefault()
    if (asked === 'fit') latestZoom.current(null)
    else latestZoom.current((chosenRef.current ?? fitRef.current) * (asked === 'in' ? STEP : 1 / STEP))
  }
  const latestKey = useRef(onKey)
  useEffect(() => {
    latestKey.current = onKey
  })

  // A screen page follows the theme while it is shown: the app switches it on the root or on a workspace's own root.
  const screen = page === 'screen'
  useEffect(() => {
    const element = frame.current
    if (!screen || !element || typeof MutationObserver === 'undefined') return
    const restyle = () => {
      const doc = element.contentDocument
      if (doc?.documentElement) applyScreenTheme(element, doc)
    }
    restyle()
    const observer = new MutationObserver(restyle)
    const watched = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] }
    observer.observe(document.documentElement, watched)
    const themed = element.parentElement?.closest('[data-theme]')
    if (themed) observer.observe(themed, watched)
    return () => observer.disconnect()
  }, [screen])

  // What the loaded document listens to, removed when the next one loads or the viewer closes.
  const detach = useRef<(() => void) | null>(null)
  useEffect(() => () => detach.current?.(), [])
  const onLoad = () => {
    const element = frame.current
    const doc = element?.contentDocument
    if (!element || !doc) return
    detach.current?.()
    if (screen) applyScreenTheme(element, doc)
    const refit = () => {
      const fitted = fittedZoom(doc)
      fitRef.current = fitted
      setFit(fitted)
      if (chosenRef.current === null) setZoom(doc, fitted)
    }
    refit()
    if (chosenRef.current !== null) setZoom(doc, chosenRef.current)
    const stopGestures = listenZoomGestures(doc, (factor, at) =>
      latestZoom.current((chosenRef.current ?? fitRef.current) * factor, at),
    )
    const key = (event: globalThis.KeyboardEvent) => latestKey.current(event)
    doc.addEventListener('keydown', key)
    // A dialog resized or a phone turned fits the pages again.
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(refit)
    resize?.observe(element)
    detach.current = () => {
      stopGestures()
      doc.removeEventListener('keydown', key)
      resize?.disconnect()
    }
    latestLoad.current?.(element)
  }

  const zoom = chosen ?? fit
  return (
    <div
      className={cn('flex h-full min-h-80 flex-col overflow-hidden rounded-md border bg-muted/60', className)}
      role="region"
      aria-label={`${title} pages`}
      onKeyDown={(event) => {
        // Keys on the bar's own buttons; inside the frame its document listens.
        if ((event.target as Element).closest('button')) onKey(event)
      }}
    >
      <ViewerToolbar start={toolbarStart}>
        <ViewerZoom
          percent={zoom === null ? null : zoom * 100}
          canOut={zoom !== null && zoom > MIN_ZOOM + 1e-3}
          canIn={zoom !== null && zoom < MAX_ZOOM - 1e-3}
          fitted={chosen === null}
          onOut={() => step(1 / STEP)}
          onIn={() => step(STEP)}
          onFit={() => zoomTo(null)}
          fitLabel="Fit to width"
          fitIcon={<ArrowLeftRight className="h-3.5 w-3.5" aria-hidden />}
        />
        <OpenInTabButton onOpen={() => openInTab(open ?? (() => new Blob([html], { type: 'text/html' })))} />
      </ViewerToolbar>
      {/* Scripts stay off (no `allow-scripts`). Same-origin only lets the viewer reach the frame's document; a fully
          opaque frame also throws on `navigator.serviceWorker`, which reaches the page as an error. */}
      <iframe
        ref={(element) => {
          frame.current = element
          frameRef?.(element)
        }}
        title={frameTitle ?? `${title} preview`}
        sandbox="allow-same-origin"
        srcDoc={html}
        onLoad={onLoad}
        className={cn('min-h-0 w-full flex-1', screen ? 'bg-background' : 'bg-white')}
      />
    </div>
  )
}
