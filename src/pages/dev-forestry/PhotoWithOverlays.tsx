/**
 * An own photo with everything drawn over it (docs/forestry-visual-quality-own-photo-redesign-2026-11-17.md, §2.3):
 * the terrain's skyline, the layers on the photo with their hidden parts dotted, the reading aids, the labels, the
 * features check's result, a tint of the ground a hovered feature or layer row covers, and a click that reads the map
 * under a pixel. Drawn in the photo's own pixels, never through MapLibre, which cannot stand at an aircraft, forces
 * roll 0 and has no lens.
 *
 * Props only: the window (`OwnPhotoDialog`) and the docked pane (`DockedPhotoPane`) both mount it. Everything it reads
 * comes from `useFieldPhoto` through `photo`; the layers' features are laid on the ground through the hook's hit
 * buffer, used only while its camera is the active camera (`poseKey`), so a moving camera never draws stale outlines.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { Layers, Loader2, RefreshCw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DisclosureCard } from '@/components/ui/disclosure'
import { useElementSize } from '@/hooks/useElementSize'
import { ToolbarPopover } from '@/components/ui/toolbar-popover'
import { DEFAULT_FIGURE_STYLE } from '@/lib/forestry/viaFigure/presets'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { svgDataUrl } from '@/lib/mapSheet/symbolSvg'
import { symbolKeyColor } from '@/lib/mapSheet/symbols'
import { cn } from '@/lib/utils'

import { pairResiduals } from './pairResiduals'
import { PHOTO_FEATURE_SOURCES, photoFeatureSummary, photoSeenBounds } from './photoFeatures'
import { hitAt } from './photoHitBuffer'
import {
  customLayerKey,
  customLayerVisibility,
  isPhotoLayerId,
  photoLayer,
  photoLayerSymbol,
  photoLayerVisibility,
  PHOTO_LAYERS,
  PHOTO_SYMBOL_REFERENCE_WIDTH_POINTS,
  type PhotoCustomLayer,
  type PhotoLayerId,
} from './photoLayers'
import { PhotoLayersPanel, type PhotoLayerAvailability } from './PhotoLayersPanel'
import { bearingTicks, distanceContours, horizonLine, photoOverlay } from './photoOverlay'
import { photoDrawOps, photoOverlayFeatures, photoPickLayers, type DrawnFeature } from './photoOverlayDraw'
import { photoInventoryWanted, resolvePhotoExtras, type PhotoPageFeatures } from './photoPageFeatures'
import { pixelsInFeature, readPhotoPixel, type PhotoPixelReading } from './photoPick'
import { SkylineDragHandles } from './SkylineDragHandles'
import type { FieldPhotoState } from './useFieldPhoto'
import { usePhotoInventory } from './usePhotoInventory'

const LAYERS_KEY = 'pgmaps.forestry-visual-quality.own-photo-layers'

/** The viewer's own layer choices, kept in this browser; the defaults when storage is unavailable. */
function storedVisibility() {
  try {
    return photoLayerVisibility(JSON.parse(window.localStorage.getItem(LAYERS_KEY) ?? 'null'))
  } catch {
    return photoLayerVisibility()
  }
}

/** The choices for layers a caller added, by key; read against the layers added now (`customLayerVisibility`). */
const CUSTOM_LAYERS_KEY = 'pgmaps.forestry-visual-quality.own-photo-added-layers'
function storedCustomVisibility(): Record<string, unknown> {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(CUSTOM_LAYERS_KEY) ?? 'null')
    return saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

const NO_PAGE_FEATURES: PhotoPageFeatures = {}
const NO_CUSTOM_LAYERS: readonly PhotoCustomLayer[] = []

const km = (meters: number) => (meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`)

export type PhotoWithOverlaysProps = {
  photo: FieldPhotoState
  /** The docked pane's size: heavier strokes, no features-check strip, a smaller reading card. */
  compact?: boolean
  /** Where the plan's pointer falls in the photo (`projectToPhoto`), drawn as a crosshair; null when off it. */
  cursorPixel?: { x: number; y: number } | null
  /** The ground under the pointer on the photo, for a marker on the plan; null when the pointer leaves. */
  onHoverGround?: (point: { lng: number; lat: number } | null) => void
  /** A click on the photo, in its pixels (after the map under it is read). */
  onPickPixel?: (x: number, y: number) => void
  /**
   * What the page holds for the layers the photo cannot read itself (inventory, VRI, candidates, inventory
   * viewpoints), with the ground each was read for. Where that ground does not take in what the camera sees, the
   * photo reads the inventory and VRI for itself once such a layer is on (`photoPageFeatures.ts`).
   */
  pageFeatures?: PhotoPageFeatures
  /** The figure style the scene's roles are drawn in; the default figure style when absent. */
  styleId?: string | null
  /**
   * Layers added beside the ones the photo reads itself (`PhotoCustomLayer`): anything with map geometry and a symbol.
   * They are laid on the terrain and hidden behind nearer ground as the built-in layers are, and listed in the panel.
   */
  customLayers?: readonly PhotoCustomLayer[]
  /** Where the layer list goes: a toolbar popover (default), or inline below the photo inside a modal window. */
  layersMenu?: 'popover' | 'inline'
  /** Show the drag-to-align handles on the skyline. */
  align?: boolean
  /** Draw the paired points: each click, where the solved camera puts its spot, and the line between. */
  showPairs?: boolean
  /** Open the reading card on a click (default); off while a click places a paired point. */
  readOnClick?: boolean
  /** Offer *Pair with the plan* in the reading card, for a clicked spot. */
  onPairPixel?: (x: number, y: number) => void
  /** Extra controls for the toolbar under the photo. */
  toolbar?: ReactNode
  className?: string
  /** Classes for the photo itself, to cap its height. */
  imageClassName?: string
}

export function PhotoWithOverlays({
  photo,
  compact = false,
  cursorPixel = null,
  onHoverGround,
  onPickPixel,
  pageFeatures = NO_PAGE_FEATURES,
  styleId = DEFAULT_FIGURE_STYLE,
  customLayers = NO_CUSTOM_LAYERS,
  layersMenu = 'popover',
  align = false,
  showPairs = false,
  readOnClick = true,
  onPairPixel,
  toolbar,
  className,
  imageClassName,
}: PhotoWithOverlaysProps) {
  const own = photo.own
  const frame = useRef<HTMLDivElement>(null)
  const tintCanvas = useRef<HTMLCanvasElement>(null)
  const [builtIn, setBuiltIn] = useState(storedVisibility)
  const [customSaved, setCustomSaved] = useState(storedCustomVisibility)
  // One record for every layer: the built-in ones by id, added ones by their key.
  const visibility = useMemo(
    (): Record<PhotoLayerId, boolean> & Record<string, boolean> => ({
      ...customLayerVisibility(customLayers, customSaved),
      ...builtIn,
    }),
    [builtIn, customLayers, customSaved],
  )
  const [hoverLayer, setHoverLayer] = useState<string | null>(null)
  const [hoverFeature, setHoverFeature] = useState<{ layer: string; index: number } | null>(null)
  const [reading, setReading] = useState<{ x: number; y: number; reading: PhotoPixelReading | null } | null>(null)
  const [preview, setPreview] = useState<{ transform: string; origin: string } | null>(null)
  const hoverFrame = useRef(0)
  // A reading and a hovered feature belong to one photo and one camera: another of either starts clean, or a stale
  // card would say what lay under a spot for a camera no longer drawn (and hide the drag handles under it).
  const shownFor = `${own?.id ?? ''}|${photo.activePoseKey ?? ''}`
  const [readFor, setReadFor] = useState(shownFor)
  if (readFor !== shownFor) {
    setReadFor(shownFor)
    setReading(null)
    setHoverFeature(null)
  }
  // Escape closes the reading card first, and only the next one the window. The window's own Escape listener sits on
  // the document in the capture phase, so the card's is on the window, which hears the key before the document does.
  const cardOpen = !!reading
  useEffect(() => {
    if (!cardOpen) return
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      setReading(null)
    }
    window.addEventListener('keydown', close, { capture: true })
    return () => window.removeEventListener('keydown', close, { capture: true })
  }, [cardOpen])

  const keep = (key: string, value: unknown) => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* A private window: the choice lasts this visit. */
    }
  }
  const setLayer = (id: string, on: boolean) => {
    if (isPhotoLayerId(id))
      setBuiltIn((current) => {
        const next = { ...current, [id]: on }
        keep(LAYERS_KEY, next)
        return next
      })
    else
      setCustomSaved((current) => {
        const next = { ...current, [id]: on }
        keep(CUSTOM_LAYERS_KEY, next)
        return next
      })
  }
  const resetLayers = () => {
    const usual = photoLayerVisibility()
    setBuiltIn(usual)
    keep(LAYERS_KEY, usual)
    setCustomSaved({})
    keep(CUSTOM_LAYERS_KEY, {})
  }

  const pose = photo.activePose
  const buffer = photo.hitBuffer && photo.hitBuffer.poseKey === photo.activePoseKey ? photo.hitBuffer : null
  const ground = photo.ownTerrain
  const reads = photo.ownFeatures?.status === 'ready' ? photo.ownFeatures.reads : null
  // The ground the camera sees: what the photo's own inventory reads ask for, and what a click is read against.
  const seen = useMemo(() => (buffer ? photoSeenBounds(buffer) : null), [buffer])
  const ownReads = usePhotoInventory(photoInventoryWanted(visibility, pageFeatures, seen), seen)
  const extras = useMemo(() => resolvePhotoExtras(pageFeatures, ownReads, seen), [pageFeatures, ownReads, seen])

  const features = useMemo(
    () => [
      ...photoOverlayFeatures(photo.ownScene, reads, extras.features),
      // Added layers' features, each under its layer's key.
      ...customLayers.flatMap((layer) =>
        layer.features.map((feature) => ({ ...feature, layer: customLayerKey(layer.id) })),
      ),
    ],
    [photo.ownScene, reads, extras.features, customLayers],
  )
  const customSymbols = useMemo(
    () => Object.fromEntries(customLayers.map((layer) => [customLayerKey(layer.id), layer.symbol])),
    [customLayers],
  )
  const unavailable: PhotoLayerAvailability = extras.unavailable

  // Features laid on the ground and projected, for the layers turned on.
  const drawn = useMemo((): DrawnFeature[] => {
    if (!pose || !buffer || !ground) return []
    const shown = features.filter((feature) => visibility[feature.layer] && !unavailable[feature.layer as PhotoLayerId])
    const paths = photoOverlay(pose, buffer, shown, { ground })
    return paths.map((entry, i) => ({ paths: entry, properties: shown[i].properties }))
  }, [pose, buffer, ground, features, visibility, unavailable])

  const aids = useMemo(
    () =>
      pose
        ? {
            horizon: visibility.horizon ? horizonLine(pose) : null,
            ticks: visibility.bearingTicks ? bearingTicks(pose) : [],
            contours: visibility.distanceContours && buffer ? distanceContours(buffer) : [],
          }
        : undefined,
    [pose, buffer, visibility.horizon, visibility.bearingTicks, visibility.distanceContours],
  )

  // Sheet points a screen pixel covers where the photo is shown, in quarter steps so a pane drag does not redraw it
  // each pixel: lines are simplified to about that.
  const shownWidth = useElementSize(frame).width
  const pixelPoints =
    shownWidth > 0 ? Math.max(0.5, Math.round((PHOTO_SYMBOL_REFERENCE_WIDTH_POINTS / shownWidth) * 4) / 4) : 1
  const overlayUrl = useMemo(() => {
    if (!own) return null
    const draw = photoDrawOps({
      photoWidth: own.width,
      photoHeight: own.height,
      visibility,
      symbols: customSymbols,
      styleId,
      skyline: photo.ownSkyline,
      features: drawn,
      aids,
      labels: !compact,
      emphasis: compact ? 2 : 1,
      pixelPoints,
    })
    return draw.ops.length ? svgDataUrl(sheetSvg(draw.ops, draw.width, draw.height, undefined, null)) : null
  }, [own, visibility, customSymbols, styleId, photo.ownSkyline, drawn, aids, compact, pixelPoints])

  // Polygons a pixel is read against, prepared once for the ground the camera sees.
  const pickLayers = useMemo(() => (buffer ? photoPickLayers(features, seen) : []), [features, buffer, seen])

  // The tint: the ground of the hovered feature, else of the hovered layer row, at the hit buffer's resolution.
  useEffect(() => {
    const canvas = tintCanvas.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!buffer || !context) {
      context?.clearRect(0, 0, canvas.width, canvas.height)
      return
    }
    canvas.width = buffer.width
    canvas.height = buffer.height
    context.clearRect(0, 0, canvas.width, canvas.height)
    const target = hoverFeature ?? (hoverLayer ? { layer: hoverLayer, index: undefined } : null)
    const layer = target ? pickLayers.find((entry) => entry.id === target.layer) : undefined
    if (!target || !layer) return
    const mask = pixelsInFeature(buffer, layer.prepared, target.index)
    const hex = symbolKeyColor(photoLayerSymbol(layer.id as PhotoLayerId, {}, styleId)).replace('#', '')
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0)
    const image = context.createImageData(buffer.width, buffer.height)
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        image.data[i * 4] = r
        image.data[i * 4 + 1] = g
        image.data[i * 4 + 2] = b
        image.data[i * 4 + 3] = 96
      }
    context.putImageData(image, 0, 0)
  }, [buffer, hoverFeature, hoverLayer, pickLayers, styleId])

  if (!own) return null

  const toPixel = (event: MouseEvent<HTMLElement>) => {
    const box = frame.current?.getBoundingClientRect()
    if (!box?.width || !box.height) return null
    return {
      x: ((event.clientX - box.left) / box.width) * own.width,
      y: ((event.clientY - box.top) / box.height) * own.height,
    }
  }
  const onMove = (event: MouseEvent<HTMLElement>) => {
    const at = toPixel(event)
    cancelAnimationFrame(hoverFrame.current)
    hoverFrame.current = requestAnimationFrame(() => {
      if (!at || !buffer) {
        onHoverGround?.(null)
        setHoverFeature(null)
        return
      }
      const hit = hitAt(buffer, at.x, at.y)
      onHoverGround?.(hit ? { lng: hit.lng, lat: hit.lat } : null)
      const under = hit ? readPhotoPixel(buffer, at.x, at.y, pickLayers) : null
      const first = under?.features[0]
      setHoverFeature((current) =>
        first
          ? current?.layer === first.layer && current.index === first.index
            ? current
            : { layer: first.layer, index: first.index }
          : null,
      )
    })
  }
  const onLeave = () => {
    cancelAnimationFrame(hoverFrame.current)
    onHoverGround?.(null)
    setHoverFeature(null)
  }
  const onClick = (event: MouseEvent<HTMLElement>) => {
    const at = toPixel(event)
    if (!at) return
    if (readOnClick) setReading({ ...at, reading: buffer ? readPhotoPixel(buffer, at.x, at.y, pickLayers) : null })
    onPickPixel?.(at.x, at.y)
  }

  const percent = (x: number, y: number) => ({ left: `${(x / own.width) * 100}%`, top: `${(y / own.height) * 100}%` })
  const sun = photo.cameraSearch.status === 'done' ? photo.cameraSearch.sun?.best : null
  const pairs = showPairs ? pairResiduals(photo.pairs, photo.pairsOff, photo.controlSolve) : []
  const pairColor = symbolKeyColor(photoLayerSymbol('skyline'))
  const layersPanel = (
    <PhotoLayersPanel
      visibility={visibility}
      onChange={setLayer}
      onHover={setHoverLayer}
      onReset={resetLayers}
      unavailable={unavailable}
      notes={extras.notes}
      styleId={styleId}
      custom={customLayers}
    />
  )
  const layersOn =
    PHOTO_LAYERS.filter((layer) => visibility[layer.id] && !unavailable[layer.id]).length +
    customLayers.filter((layer) => layer.features.length && visibility[customLayerKey(layer.id)]).length
  const drawing = !!pose && !buffer

  return (
    <div className={cn('min-w-0 space-y-2', className)}>
      <div className="flex justify-center rounded-md bg-muted/50">
        <div
          ref={frame}
          className="relative inline-block max-w-full overflow-hidden"
          data-testid={compact ? 'docked-photo-frame' : 'own-photo-frame'}
        >
          <img
            src={own.src}
            alt={`Your photo ${own.name}${onPickPixel || onPairPixel ? ': click to read the map under a spot' : ''}`}
            className={cn('block h-auto w-auto max-w-full cursor-crosshair rounded-sm', imageClassName)}
            draggable={false}
            onClick={onClick}
            onMouseMove={onMove}
            onMouseLeave={onLeave}
          />
          <canvas
            ref={tintCanvas}
            className="pointer-events-none absolute inset-0 h-full w-full"
            style={{ imageRendering: 'pixelated' }}
            aria-hidden="true"
          />
          {overlayUrl && (
            <img
              src={overlayUrl}
              alt=""
              aria-hidden="true"
              data-testid="own-photo-overlay"
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={preview ? { transform: preview.transform, transformOrigin: preview.origin } : undefined}
            />
          )}
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${own.width} ${own.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {photo.ownSkyline && photo.ownSkyline.length > 1 && visibility.skyline && (
              // Kept for tests and assistive checks: where the skyline is, as one plain line under the drawn symbol.
              <polyline
                data-testid="own-photo-skyline"
                points={photo.ownSkyline.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}
                fill="none"
                stroke="none"
              />
            )}
            {sun?.inFrame && sun.pixel && (
              <circle
                cx={sun.pixel.x}
                cy={sun.pixel.y}
                r={own.width / 45}
                fill="none"
                stroke={pairColor}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {pairs.map((row) =>
              row.solvedPixel ? (
                <g key={row.id}>
                  <line
                    x1={row.pixel[0]}
                    y1={row.pixel[1]}
                    x2={row.solvedPixel.x}
                    y2={row.solvedPixel.y}
                    stroke={pairColor}
                    strokeWidth={1.5}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle
                    cx={row.solvedPixel.x}
                    cy={row.solvedPixel.y}
                    r={own.width / 160}
                    fill="none"
                    stroke={pairColor}
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ) : null,
            )}
            {cursorPixel && (
              <g data-testid="own-photo-linked-cursor">
                <line
                  x1={cursorPixel.x - own.width / 40}
                  x2={cursorPixel.x + own.width / 40}
                  y1={cursorPixel.y}
                  y2={cursorPixel.y}
                  stroke={pairColor}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={cursorPixel.x}
                  x2={cursorPixel.x}
                  y1={cursorPixel.y - own.width / 40}
                  y2={cursorPixel.y + own.width / 40}
                  stroke={pairColor}
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
          </svg>
          {pairs.map((row) => (
            <span
              key={row.id}
              className={cn(
                'pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-2xs font-bold shadow',
                row.on
                  ? 'border-white bg-primary text-primary-foreground'
                  : 'border-dashed border-white bg-background/80 text-foreground',
              )}
              style={percent(row.pixel[0], row.pixel[1])}
              title={row.on ? `Point ${row.n}` : `Point ${row.n}, a check point`}
            >
              {row.n}
            </span>
          ))}
          {showPairs && photo.pendingPixel && (
            <span
              className="pointer-events-none absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white bg-warning text-2xs font-bold text-white shadow"
              style={percent(photo.pendingPixel[0], photo.pendingPixel[1])}
            >
              ?
            </span>
          )}
          {align && pose && photo.ownSkyline && !reading && (
            <SkylineDragHandles
              frame={frame}
              pose={pose}
              skyline={photo.ownSkyline}
              onPreview={setPreview}
              onAlign={(angles) => photo.setOwnPose(angles)}
            />
          )}
          {reading && (
            <ReadingCard
              compact={compact}
              reading={reading.reading}
              style={percent(reading.x, reading.y)}
              flip={reading.x > own.width * 0.6}
              onPair={onPairPixel ? () => onPairPixel(reading.x, reading.y) : undefined}
              onClose={() => setReading(null)}
            />
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
        {layersMenu === 'popover' && (
          <ToolbarPopover
            label="Layers on the photo"
            icon={<Layers className="h-4 w-4" />}
            count={layersOn}
            width={340}
          >
            {layersPanel}
          </ToolbarPopover>
        )}
        {drawing && (
          <span className="flex items-center gap-1" role="status">
            <Loader2 className="h-3 w-3 animate-spin" />
            Drawing the layers for this camera…
          </span>
        )}
        {!pose && <span>Layers draw once the terrain round the photo has loaded.</span>}
        {toolbar}
      </div>
      {layersMenu === 'inline' && (
        <DisclosureCard title="Layers on the photo" summary={`${layersOn} on`} contentClassName="px-0 pb-0">
          {layersPanel}
        </DisclosureCard>
      )}
      {!compact && <FeaturesCheck photo={photo} />}
    </div>
  )
}

/** What the map says about a clicked spot: distance, height, slope, and the block, stand or unit under it. */
function ReadingCard({
  reading,
  compact,
  style,
  flip,
  onPair,
  onClose,
}: {
  reading: PhotoPixelReading | null
  compact: boolean
  style: { left: string; top: string }
  flip: boolean
  onPair?: () => void
  onClose: () => void
}) {
  return (
    <div
      className={cn(
        'absolute z-10 mt-2 space-y-1 rounded-md border bg-popover p-2 text-2xs leading-4 shadow-lg',
        compact ? 'w-44' : 'w-56',
        flip && '-translate-x-full',
      )}
      style={style}
      role="dialog"
      aria-label="The map under this spot"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{reading ? 'Under this spot' : 'Sky, or no terrain here'}</p>
        <button type="button" aria-label="Close" className="text-muted-foreground" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {reading && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 tabular-nums">
          <dt className="text-muted-foreground">Distance</dt>
          <dd>{km(reading.distanceMeters)}</dd>
          <dt className="text-muted-foreground">Elevation</dt>
          <dd>{Math.round(reading.elevation)} m</dd>
          <dt className="text-muted-foreground">Slope</dt>
          <dd>
            {reading.slopePercent === null ? 'not read' : `${Math.round(reading.slopePercent)}%`}
            {reading.aspectDegrees !== null ? `, facing ${Math.round(reading.aspectDegrees)}°` : ''}
          </dd>
          {reading.features.map((feature) => (
            <FeatureRow key={`${feature.layer}-${feature.index}`} layer={feature.layer} label={feature.label} />
          ))}
        </dl>
      )}
      {reading && (
        <p className="text-muted-foreground">Terrain only, for the camera as it stands: no canopy, not the run.</p>
      )}
      {onPair && reading && (
        <Button type="button" size="xs" variant="outline" className="w-full touch:h-10" onClick={onPair}>
          Pair with the same spot on the plan
        </Button>
      )}
    </div>
  )
}

function FeatureRow({ layer, label }: { layer: string; label?: string }) {
  let name = layer
  try {
    name = photoLayer(layer as PhotoLayerId).label
  } catch {
    /* A page-fed layer id the catalogue does not list: its id is its name. */
  }
  return (
    <>
      <dt className="text-muted-foreground">{name}</dt>
      <dd className="truncate">{label ?? 'unnamed'}</dd>
    </>
  )
}

/**
 * The features check under the photo: what was read for the ground the camera sees, layer by layer, and a read again
 * for the camera as it stands. A layer that was not read says *Not read*, never *None*.
 */
function FeaturesCheck({ photo }: { photo: FieldPhotoState }) {
  const features = photo.ownFeatures
  if (!photo.activePose) return null
  const stale = !!features && features.poseKey !== photo.activePoseKey
  return (
    <section className="space-y-1 rounded-md border border-border p-2 text-2xs" aria-label="Features check">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-foreground">
          Features check{' '}
          <span className="font-normal text-muted-foreground">
            · lakes on water, roads on roads, recent cutblocks on clearings
          </span>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="touch:h-10"
          disabled={features?.status === 'loading'}
          onClick={() => void photo.readFeatures()}
        >
          {features?.status === 'loading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {features ? 'Read again for this camera' : 'Read for this camera'}
        </Button>
      </div>
      {features?.status === 'failed' && <p className="text-warning-foreground">Not read: {features.message}</p>}
      {features?.status === 'ready' && (
        <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
          {PHOTO_FEATURE_SOURCES.map((source) => {
            const summary = photoFeatureSummary(source, features.reads?.[source.id])
            return (
              <li
                key={source.id}
                title={summary.note}
                className={cn(summary.tone === 'warning' && 'text-warning-foreground')}
              >
                {source.label}: {summary.value}
              </li>
            )
          })}
        </ul>
      )}
      {stale && <p className="text-muted-foreground">Read for an earlier camera: read again to follow this one.</p>}
    </section>
  )
}
