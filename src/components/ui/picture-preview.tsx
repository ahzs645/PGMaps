/**
 * A picture preview (a block map sheet's PNG or SVG, an analysis sheet, an export's geometry) in the same viewer as
 * every other file preview (`docs/shared-ui.md`, **File previews**): the shared bar over it (zoom, *Open in a new
 * tab*), and `ZoomPan` under it with the viewers' gestures. A pinch or Ctrl/⌘ + wheel zooms about the pointer, a plain
 * wheel moves a zoomed picture and scrolls the dialog over a fitted one, a drag moves a zoomed picture, a double click
 * zooms in or fits, and `+`, `-` and `0` work while it has focus.
 */
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { useElementSize } from '@/hooks/useElementSize'
import { cn } from '@/lib/utils'

import { OpenInTabButton, useOpenInTab, ViewerToolbar, ViewerZoom } from './viewer-toolbar'
import { ZoomPan } from './zoom-pan'
import { clampView, zoomAbout, FIT_VIEW, type ZoomPanView } from './zoomPanView'

const MAX_SCALE = 8
const STEP = 1.5

export type ZoomablePreviewProps = {
  /** What is shown, for the region's name: "Block map sheet" gives "Block map sheet picture". */
  title: string
  /** The picture, or a drawing, centred in the box. */
  children: ReactNode
  /** The file *Open in a new tab* opens; absent, the bar has no such button. */
  open?: Blob | string | (() => Blob | string)
  /** A click on the picture (not a drag) opens what sets it, e.g. the sheet setup; `pickLabel` names it. */
  onPick?: () => void
  pickLabel?: string
  /** Left of the bar: a caption, such as which page of a series this is. */
  toolbarStart?: ReactNode
  /** Right of the bar, before the zoom: a copy button. */
  toolbarEnd?: ReactNode
  /** A change fits the picture again (another output); a rebuilt picture of the same output keeps its zoom. */
  resetKey?: string | number | null
  className?: string
  /**
   * The box the picture sits in: by default the app's background (white in light mode, black in dark), so a sheet's
   * own white paper stands on it as a PDF page does; the inset tone for a drawing.
   */
  stageClassName?: string
}

/** Any picture or drawing in the file viewer. `PicturePreview` is this with an image. */
export function ZoomablePreview({
  title,
  children,
  open,
  onPick,
  pickLabel,
  toolbarStart,
  toolbarEnd,
  resetKey = null,
  className,
  stageClassName = 'bg-background',
}: ZoomablePreviewProps) {
  const stage = useRef<HTMLDivElement>(null)
  const box = useElementSize(stage)
  const [view, setView] = useState<ZoomPanView>(FIT_VIEW)
  const [shownFor, setShownFor] = useState(resetKey)
  if (shownFor !== resetKey) {
    setShownFor(resetKey)
    setView(FIT_VIEW)
  }
  const openInTab = useOpenInTab()
  const step = (factor: number) =>
    setView((from) =>
      clampView(
        zoomAbout(from, from.scale * factor, { x: box.width / 2, y: box.height / 2 }, MAX_SCALE),
        box,
        MAX_SCALE,
      ),
    )
  const picked = onPick
    ? {
        role: 'button' as const,
        tabIndex: 0,
        'aria-label': pickLabel ?? `${title}: open its settings`,
        title: pickLabel,
        onClick: onPick,
        onKeyDown: (event: KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          onPick()
        },
        className:
          'flex h-full w-full cursor-pointer items-center justify-center rounded-sm p-2 hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      }
    : null
  return (
    <div
      className={cn('flex h-full min-h-60 flex-col overflow-hidden rounded-md border bg-muted/60', className)}
      role="region"
      aria-label={`${title} picture`}
    >
      <ViewerToolbar start={toolbarStart}>
        {toolbarEnd}
        <ViewerZoom
          percent={view.scale * 100}
          canOut={view.scale > 1.001}
          canIn={view.scale < MAX_SCALE - 0.001}
          fitted={view.scale <= 1.001}
          onOut={() => step(1 / STEP)}
          onIn={() => step(STEP)}
          onFit={() => setView(FIT_VIEW)}
          fitLabel="Fit the picture"
        />
        {open !== undefined && <OpenInTabButton onOpen={() => openInTab(open)} />}
      </ViewerToolbar>
      <div ref={stage} className={cn('relative min-h-0 flex-1', stageClassName)}>
        <ZoomPan
          label={title}
          view={view}
          onViewChange={setView}
          controls={false}
          maxScale={MAX_SCALE}
          wheel="modified"
          doubleClick={!onPick}
          keys
          className="absolute inset-0"
        >
          {picked ? (
            <div {...picked}>{children}</div>
          ) : (
            <div className="flex h-full w-full items-center justify-center p-2">{children}</div>
          )}
        </ZoomPan>
      </div>
    </div>
  )
}

/** A picture file in the viewer: the same bytes the download writes, or the address of them. */
export function PicturePreview({
  src,
  alt,
  width,
  height,
  ...rest
}: Omit<ZoomablePreviewProps, 'children'> & { src: string; alt?: string; width?: number; height?: number }) {
  return (
    <ZoomablePreview open={rest.open ?? src} {...rest}>
      <img
        src={src}
        alt={alt ?? `${rest.title} preview`}
        width={width}
        height={height}
        draggable={false}
        className="max-h-full max-w-full select-none object-contain"
      />
    </ZoomablePreview>
  )
}
