import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Download, Globe, Layers, Map, RotateCcw, ScanEye, Shapes, Trees, Waves } from 'lucide-react'

import { DevLibraryBackLink } from '@/components/dev/PageBackLink'
import { Button } from '@/components/ui/button'
import { CheckboxField, NumberField, SelectField } from '@/components/ui/form-field'
import { NumericRangeField } from '@/components/ui/numeric-range-field'
import { PicturePreview, ZoomablePreview } from '@/components/ui/picture-preview'
import { TabBar } from '@/components/ui/tab-bar'
import { ToggleRow } from '@/components/ui/toggle-row'
import { ToolPageHeader } from '@/components/ui/tool-page-header'
import { withBase } from '@/lib/dataUrl'
import { downloadText } from '@/lib/download'
import { buildPreviewSvg } from '@/lib/illustratedMap/preview'
import {
  buildElementSheetSvg,
  buildElementSvg,
  buildHatchSwatchSvg,
  buildIllustratedMapSvg,
  buildPatchHatchSwatchSvg,
  DEFAULT_COMPOSITION_OPTIONS,
  DEFAULT_HATCH_OPTIONS,
  DEFAULT_PAGE8_HATCH_OPTIONS,
  ELEMENT_CATALOG,
  type CompositionOptions,
  type HatchOptions,
  type PatchHatchStyleOptions,
} from '@/lib/illustratedMap'
import { ORGANIC_HATCH_LIMITS, PATCH_HATCH_LIMITS } from '@pgmaps/geo-toolkit/patterns'
import {
  buildGeographicLandMaskSvg,
  buildGeographicMapSvg,
  DEFAULT_GEOGRAPHIC_OPTIONS,
  GEOGRAPHIC_MAP_INFO,
  type GeographicMapOptions,
} from '@/lib/illustratedMap/geographic'

type View = 'map' | 'live' | 'elements' | 'hatching' | 'compare'
type MapGeometry = 'geographic' | 'schematic'
type HatchCoverage = NonNullable<GeographicMapOptions['coverage']>
type HatchingPreview = 'pattern' | 'land-mask'
type HatchStyle = NonNullable<GeographicMapOptions['hatchStyle']>
const VIEWS: View[] = ['map', 'live', 'elements', 'hatching', 'compare']
// The map engine loads with its tab only.
const LiveHatchMap = lazy(() => import('./dev-illustrated-map/LiveHatchMap'))
const LAYERS = [
  { id: 'hatching', label: 'Forest hatching' },
  { id: 'roads', label: 'Highways and connections' },
  { id: 'symbols', label: 'Illustrations and markers' },
  { id: 'labels', label: 'Place names and title' },
] as const
const CATEGORY_LABELS = {
  illustration: 'Landscape and activities',
  navigation: 'Navigation and destinations',
  tree: 'Trees',
  drafting: 'Lines and drafting',
}
const REFERENCE = withBase('/illustrated-map/page8-reference.jpg')
const SVG_TYPE = 'image/svg+xml;charset=utf-8'

const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
const EMPTY_SVG_URL = `data:${SVG_TYPE},${encodeURIComponent(EMPTY_SVG)}`

function useSvgUrl(svg: string) {
  const [url, setUrl] = useState(EMPTY_SVG_URL)
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([buildPreviewSvg(svg || EMPTY_SVG)], { type: SVG_TYPE }))
    // Blob URLs are external resources: allocate only after commit and release
    // each previous preview, including React's development remount cycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [svg])
  return url
}

function SvgPreview({
  svg,
  title,
  resetKey,
  className = 'min-h-[300px] sm:min-h-[460px] lg:h-[min(70vh,800px)]',
}: {
  svg: string
  title: string
  resetKey: string
  className?: string
}) {
  const src = useSvgUrl(svg)
  return (
    <PicturePreview
      title={title}
      src={src}
      open={() => new Blob([svg], { type: SVG_TYPE })}
      resetKey={resetKey}
      className={className}
      stageClassName="bg-muted/40"
      toolbarStart={<span className="text-xs text-muted-foreground">Editable SVG</span>}
    />
  )
}

export default function DevIllustratedMap() {
  // `?view=live` (or any tab) opens on that tab.
  const [view, setView] = useState<View>(() => {
    const asked = new URLSearchParams(window.location.search).get('view')
    return VIEWS.includes(asked as View) ? (asked as View) : 'map'
  })
  const [geometry, setGeometry] = useState<MapGeometry>('geographic')
  const [coverage, setCoverage] = useState<HatchCoverage>(DEFAULT_GEOGRAPHIC_OPTIONS.coverage ?? 'coastal')
  const [hatchingPreview, setHatchingPreview] = useState<HatchingPreview>('pattern')
  const [hatch, setHatch] = useState<HatchOptions>({ ...DEFAULT_HATCH_OPTIONS })
  const deferredHatch = useDeferredValue(hatch)
  const [hatchStyle, setHatchStyle] = useState<HatchStyle>('contour')
  const [patchHatch, setPatchHatch] = useState<PatchHatchStyleOptions>({ ...DEFAULT_PAGE8_HATCH_OPTIONS })
  const deferredPatchHatch = useDeferredValue(patchHatch)
  const [composition, setComposition] = useState<CompositionOptions>({ ...DEFAULT_COMPOSITION_OPTIONS })
  const deferredComposition = useDeferredValue(composition)
  const [layers, setLayers] = useState({ hatching: true, roads: true, symbols: true, labels: true })
  const [elementId, setElementId] = useState('all')
  const [overlay, setOverlay] = useState(50)
  const [comparisonMode, setComparisonMode] = useState('overlay')
  const [referenceFailed, setReferenceFailed] = useState(false)
  const isGeographic = geometry === 'geographic'
  const mapTitle = isGeographic ? 'Real geography with illustrated styling' : 'Schematic reference reconstruction'
  // The drawing is built only for the tabs that show it; the live map and the elements do not,
  // and building it takes seconds with the patch style. A download from those tabs builds it then.
  const drawsMap = view === 'map' || view === 'hatching' || view === 'compare'
  const buildMapSvg = () =>
    geometry === 'geographic'
      ? buildGeographicMapSvg({ hatch, composition, layers, coverage, hatchStyle, patchHatch })
      : buildIllustratedMapSvg({ hatch, composition, layers })
  const mapSvg = useMemo(
    () =>
      !drawsMap
        ? ''
        : geometry === 'geographic'
          ? buildGeographicMapSvg({
              hatch: deferredHatch,
              composition: deferredComposition,
              layers,
              coverage,
              hatchStyle,
              patchHatch: deferredPatchHatch,
            })
          : buildIllustratedMapSvg({ hatch: deferredHatch, composition: deferredComposition, layers }),
    [drawsMap, deferredHatch, deferredComposition, layers, geometry, coverage, hatchStyle, deferredPatchHatch],
  )
  const mapUrl = useSvgUrl(view === 'hatching' ? mapSvg : '')
  const overlaySvg = useMemo(
    () =>
      geometry === 'schematic' && view === 'compare' && comparisonMode === 'overlay'
        ? buildIllustratedMapSvg({
            hatch: deferredHatch,
            composition: deferredComposition,
            layers,
            transparentBackground: true,
          })
        : '',
    [deferredHatch, deferredComposition, layers, view, comparisonMode, geometry],
  )
  const patchStyle = isGeographic && hatchStyle === 'patch'
  const showsSwatch = view === 'hatching'
  const swatchSvg = useMemo(
    () =>
      !showsSwatch
        ? ''
        : patchStyle
          ? buildPatchHatchSwatchSvg(deferredPatchHatch)
          : buildHatchSwatchSvg(deferredHatch),
    [showsSwatch, patchStyle, deferredHatch, deferredPatchHatch],
  )
  const showLandMask = isGeographic && view === 'hatching' && hatchingPreview === 'land-mask'
  const landMaskSvg = useMemo(() => (showLandMask ? buildGeographicLandMaskSvg() : ''), [showLandMask])
  const sheetSvg = useMemo(() => buildElementSheetSvg(), [])
  const element = ELEMENT_CATALOG.find((entry) => entry.id === elementId)
  const elementSvg = useMemo(() => (elementId === 'all' ? sheetSvg : buildElementSvg(elementId)), [elementId, sheetSvg])
  const overlayUrl = useSvgUrl(overlaySvg)
  const currentSvg =
    view === 'elements' ? elementSvg : view === 'hatching' ? (showLandMask ? landMaskSvg : swatchSvg) : mapSvg
  const filename =
    view === 'elements'
      ? element
        ? `rainforest-${element.id}.svg`
        : 'rainforest-elements.svg'
      : view === 'hatching'
        ? showLandMask
          ? 'rainforest-geographic-land-mask.svg'
          : 'rainforest-hatching.svg'
        : isGeographic
          ? `rainforest-to-rockies-geographic${coverage === 'northern' ? '-northern' : ''}${patchStyle ? '-page8' : ''}.svg`
          : 'rainforest-to-rockies-schematic.svg'
  const updating = deferredHatch !== hatch || deferredComposition !== composition || deferredPatchHatch !== patchHatch
  const activeHatch: HatchOptions = patchStyle ? patchHatch : hatch
  const limits = patchStyle ? PATCH_HATCH_LIMITS : ORGANIC_HATCH_LIMITS
  const updateHatch = (key: keyof HatchOptions, value: number) =>
    patchStyle
      ? setPatchHatch((previous) => ({ ...previous, [key]: value }))
      : setHatch((previous) => ({ ...previous, [key]: value }))

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-4 pb-12 pt-24 sm:px-6 md:pt-10">
      <ToolPageHeader
        className="mb-0"
        back={<DevLibraryBackLink />}
        eyebrow="Illustrated map workshop"
        eyebrowIcon={Trees}
        title="Rainforest to Rockies"
        description="Build the page 8 illustration style on real coastlines and roads. Adjust the forest texture, inspect each symbol, and download an editable vector map."
      />
      <div className="grid items-end gap-4 lg:grid-cols-[minmax(0,1fr)_260px_auto]">
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          {isGeographic
            ? 'Coastlines and highways come from geographic data. Hatching is clipped to the land boundary, while trees and activity motifs remain decorative.'
            : 'A schematic reconstruction of Destination BC’s page 8 reference. Its positions are illustration coordinates. Curved-band hatching and constructed symbols keep the drawing editable.'}
        </p>
        <SelectField
          label="Map geometry"
          value={geometry}
          onChange={(event) => setGeometry(event.target.value as MapGeometry)}
        >
          <option value="geographic">Real geography</option>
          <option value="schematic">Schematic reference</option>
        </SelectField>
        <Button
          type="button"
          onClick={() => downloadText(currentSvg || buildMapSvg(), filename, SVG_TYPE)}
          disabled={updating}
        >
          <Download className="h-4 w-4" aria-hidden />
          Download{' '}
          {view === 'elements' ? 'element' : view === 'hatching' ? (showLandMask ? 'land mask' : 'hatch') : 'map'} SVG
        </Button>
      </div>

      <TabBar<View>
        value={view}
        onChange={setView}
        idPrefix="illustrated-map"
        label="Illustrated map views"
        options={[
          { value: 'map', label: 'Map', icon: Map },
          { value: 'live', label: 'Live map', icon: Globe },
          { value: 'elements', label: `Elements (${ELEMENT_CATALOG.length})`, icon: Shapes },
          { value: 'hatching', label: 'Hatching', icon: Waves },
          { value: 'compare', label: 'Compare with page 8', icon: ScanEye },
        ]}
      />

      <div className="grid items-start gap-5 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside
          className="order-2 grid min-w-0 gap-4 sm:grid-cols-2 xl:order-1 xl:grid-cols-1"
          aria-label="Drawing controls"
        >
          <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="hatching-heading">
            <div className="flex items-center gap-2">
              <Waves className="h-4 w-4 text-muted-foreground" aria-hidden />
              <h2 id="hatching-heading" className="font-semibold">
                Forest hatching
              </h2>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Short strokes follow flowing bands, clipped to the land. The pattern keeps its own flow. Compare the
              texture at the full-map scale as well as enlarged.
            </p>
            {isGeographic && (
              <SelectField
                label="Hatch coverage"
                value={coverage}
                onChange={(event) => setCoverage(event.target.value as HatchCoverage)}
                description="Northern BC adds the reference's broad northwestern field. All three choices use the same land mask; the hatch remains decorative."
              >
                <option value="coastal">Coastal style</option>
                <option value="northern">Northern BC · reference style</option>
                <option value="province">All BC land</option>
              </SelectField>
            )}
            {isGeographic && (
              <SelectField
                label="Hatch style"
                value={hatchStyle}
                onChange={(event) => setHatchStyle(event.target.value as HatchStyle)}
                description="Page 8 draws the reference's own texture patch by patch: stacked waving ribbons whose strokes lean with them, fitted to the brand guidelines by measurement."
              >
                <option value="contour">Continuous bands</option>
                <option value="patch">Page 8 · patches</option>
              </SelectField>
            )}
            <NumericRangeField
              label="Stroke spacing"
              value={activeHatch.spacing}
              min={limits.spacing.min}
              max={limits.spacing.max}
              step={0.1}
              unit="px"
              onChange={(value) => updateHatch('spacing', value)}
            />
            <NumericRangeField
              label="Band height"
              value={activeHatch.bandHeight}
              min={limits.bandHeight.min}
              max={limits.bandHeight.max}
              step={0.5}
              unit="px"
              onChange={(value) => updateHatch('bandHeight', value)}
            />
            <NumericRangeField
              label="Stroke width"
              value={activeHatch.strokeWidth}
              min={0.3}
              max={2.4}
              step={0.05}
              unit="px"
              onChange={(value) => updateHatch('strokeWidth', value)}
            />
            <NumericRangeField
              label="Band curvature"
              value={activeHatch.curvature}
              min={0}
              max={24}
              step={0.5}
              onChange={(value) => updateHatch('curvature', value)}
            />
            {patchStyle && (
              <>
                <NumericRangeField
                  label="Patch width"
                  value={patchHatch.patchSize}
                  min={PATCH_HATCH_LIMITS.patchSize.min}
                  max={PATCH_HATCH_LIMITS.patchSize.max}
                  step={5}
                  unit="px"
                  onChange={(patchSize) => setPatchHatch((previous) => ({ ...previous, patchSize }))}
                />
                <NumericRangeField
                  label="Patch lean"
                  value={patchHatch.lean}
                  min={PATCH_HATCH_LIMITS.lean.min}
                  max={PATCH_HATCH_LIMITS.lean.max}
                  step={1}
                  unit="°"
                  onChange={(lean) => setPatchHatch((previous) => ({ ...previous, lean }))}
                />
              </>
            )}
            <NumberField
              label="Pattern seed"
              value={activeHatch.seed}
              min={0}
              max={999999}
              step={1}
              precision={0}
              updateOn="commit"
              clampOn="commit"
              onValueChange={(value) => updateHatch('seed', value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  patchStyle
                    ? setPatchHatch({ ...DEFAULT_PAGE8_HATCH_OPTIONS })
                    : setHatch({ ...DEFAULT_HATCH_OPTIONS })
                }
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reset hatching
              </Button>
              <span className="text-xs text-muted-foreground" role="status">
                {updating ? 'Updating drawing…' : 'Drawing current'}
              </span>
            </div>
          </section>

          <div className="space-y-4">
            <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="composition-heading">
              <h2 id="composition-heading" className="font-semibold">
                Labels and overlaps
              </h2>
              <NumericRangeField
                label="White label outline width"
                value={composition.labelHalo}
                min={0}
                max={5}
                step={0.2}
                unit="px"
                description="A white edge follows each letter where labels meet roads or hatching. Values are in drawing pixels."
                onChange={(labelHalo) => setComposition((previous) => ({ ...previous, labelHalo }))}
              />
              <CheckboxField
                label="Allow illustration overlap"
                checked={composition.allowIllustrationOverlap}
                onCheckedChange={(allowIllustrationOverlap) =>
                  setComposition((previous) => ({ ...previous, allowIllustrationOverlap }))
                }
                description="Let drawings such as the bear cross the forest edge independently of the land-clipped hatching."
              />
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  setComposition((previous) => ({
                    ...previous,
                    labelHalo: DEFAULT_COMPOSITION_OPTIONS.labelHalo,
                    allowIllustrationOverlap: DEFAULT_COMPOSITION_OPTIONS.allowIllustrationOverlap,
                  }))
                }
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reset labels and overlaps
              </Button>
            </section>
            <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="map-layers-heading">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" aria-hidden />
                <h2 id="map-layers-heading" className="font-semibold">
                  Map layers
                </h2>
              </div>
              {LAYERS.map((layer) => (
                <ToggleRow
                  key={layer.id}
                  label={layer.label}
                  active={layers[layer.id]}
                  tone="primary"
                  onClick={() => setLayers((previous) => ({ ...previous, [layer.id]: !previous[layer.id] }))}
                />
              ))}
              <p className="text-xs leading-5 text-muted-foreground">
                These choices apply to the map preview and its SVG export.
              </p>
            </section>
            <section className="space-y-2 rounded-lg border bg-card p-4" aria-labelledby="construction-heading">
              <h2 id="construction-heading" className="font-semibold">
                How the drawing is made
              </h2>
              <p className="text-xs leading-5 text-muted-foreground">
                {isGeographic
                  ? 'Geographic land and highway data define the base map. Trees share a branch construction, and activity motifs are assembled from shapes and strokes. The Elements view explains each construction.'
                  : 'Authored curves describe the schematic coastline and roads. Trees share a branch construction, and activity symbols are assembled from shapes and strokes. The Elements view explains each construction.'}
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                {isGeographic
                  ? 'Page 8 is the style reference. Hatch coverage and the decorative motifs are illustration choices, not mapped forest or activity locations.'
                  : 'Page 8 is the visual reference. Compare proportions and placement there; the reconstructed drawing is an editable interpretation.'}
              </p>
              {isGeographic && (
                <>
                  <p className="text-xs leading-5 text-muted-foreground">{GEOGRAPHIC_MAP_INFO.projection}</p>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {GEOGRAPHIC_MAP_INFO.sources.map((source, index) => (
                      <span key={source.url}>
                        {index > 0 && ' · '}
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {source.title}
                        </a>
                      </span>
                    ))}
                  </p>
                </>
              )}
            </section>
          </div>
        </aside>

        <div className="order-1 min-w-0 xl:order-2">
          {VIEWS.map((id) => (
            <section
              key={id}
              role="tabpanel"
              id={`illustrated-map-panel-${id}`}
              aria-labelledby={`illustrated-map-tab-${id}`}
              hidden={view !== id}
              className="space-y-4"
            >
              {id === 'map' && view === id && <SvgPreview svg={mapSvg} title={mapTitle} resetKey={`map-${geometry}`} />}
              {id === 'live' && view === id && (
                <>
                  <p className="text-xs leading-5 text-muted-foreground">
                    The same hatch and coverage on a live map, drawn as tiles of one continuous field: a pan shows more
                    of it, with no repeat or seam, and the strokes keep their size on screen up to zoom{' '}
                    {hatchStyle === 'patch' ? 13 : 10}. Real geography only.
                  </p>
                  <Suspense fallback={<p className="text-sm text-muted-foreground">Loading the map…</p>}>
                    <LiveHatchMap
                      coverage={coverage}
                      hatchStyle={hatchStyle}
                      hatch={deferredHatch}
                      patchHatch={deferredPatchHatch}
                    />
                  </Suspense>
                </>
              )}
              {id === 'hatching' && view === id && (
                <>
                  {isGeographic && (
                    <SelectField
                      label="Hatching preview"
                      value={hatchingPreview}
                      onChange={(event) => setHatchingPreview(event.target.value as HatchingPreview)}
                    >
                      <option value="pattern">Pattern swatch</option>
                      <option value="land-mask">Geographic land mask</option>
                    </SelectField>
                  )}
                  <SvgPreview
                    svg={showLandMask ? landMaskSvg : swatchSvg}
                    title={showLandMask ? 'Geographic land mask' : 'Generated forest hatching'}
                    resetKey={showLandMask ? 'land-mask' : 'hatching'}
                  />
                  <p className="text-sm leading-6 text-muted-foreground">
                    {showLandMask
                      ? 'These geographic land shapes clip the hatching in all three coverage modes. Download the land mask SVG to inspect the boundary independently of the drawing.'
                      : 'Change spacing to control density, band height to change stroke length, and curvature to change the flow. The map clips this pattern to the land; it does not turn the bands to follow the boundary.'}
                  </p>
                  <div className="space-y-3 rounded-lg border bg-card p-4">
                    <h2 className="font-semibold">Compare at map scale</h2>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Fine strokes merge as the map gets smaller. Compare the overall density and flow in these small
                      previews before judging the enlarged swatch.
                    </p>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                      <PicturePreview
                        title="Page 8 at map scale"
                        src={REFERENCE}
                        alt="Original page 8 map reduced to show the forest texture at map scale"
                        className="h-60 min-h-0"
                        toolbarStart={<span className="text-xs text-muted-foreground">Original</span>}
                      />
                      <PicturePreview
                        title={isGeographic ? 'Geographic drawing at map scale' : 'Schematic drawing at map scale'}
                        src={mapUrl}
                        alt="Current reconstructed map reduced to show the forest texture at map scale"
                        open={() => new Blob([mapSvg], { type: SVG_TYPE })}
                        className="h-60 min-h-0"
                        toolbarStart={
                          <span className="text-xs text-muted-foreground">
                            {isGeographic ? 'Real geography' : 'Schematic reference'}
                          </span>
                        }
                      />
                    </div>
                  </div>
                </>
              )}
              {id === 'elements' && view === id && (
                <>
                  <SelectField
                    label="Inspect an element"
                    value={elementId}
                    onChange={(event) => setElementId(event.target.value)}
                  >
                    <option value="all">All elements — contact sheet</option>
                    {Object.entries(CATEGORY_LABELS).map(([category, title]) => (
                      <optgroup key={category} label={title}>
                        {ELEMENT_CATALOG.filter((entry) => entry.category === category).map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.title}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </SelectField>
                  {element && (
                    <div className="rounded-lg border bg-card px-4 py-3">
                      <h2 className="font-semibold">{element.title}</h2>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{element.construction}</p>
                    </div>
                  )}
                  <SvgPreview
                    svg={elementSvg}
                    title={element?.title ?? 'All reconstructed elements'}
                    resetKey={elementId}
                  />
                </>
              )}
              {id === 'compare' && view === id && (
                <>
                  {isGeographic ? (
                    <p className="text-sm leading-6 text-muted-foreground">
                      Page 8 is shown beside the geographic map as a style reference. Its schematic positions differ
                      from the real coastline and roads, so the two views are compared side by side.
                    </p>
                  ) : (
                    <SelectField
                      label="Comparison mode"
                      value={comparisonMode}
                      onChange={(event) => setComparisonMode(event.target.value)}
                    >
                      <option value="overlay">Overlay reconstructed ink on page 8</option>
                      <option value="side-by-side">Original and reconstruction side by side</option>
                    </SelectField>
                  )}
                  {!isGeographic && comparisonMode === 'overlay' ? (
                    <>
                      <NumericRangeField
                        label="Reconstructed ink opacity"
                        min={0}
                        max={100}
                        step={1}
                        value={overlay}
                        unit="%"
                        description="0% shows page 8 alone. Increase the opacity to compare the reconstructed lines, symbols, and labels over the original."
                        onChange={setOverlay}
                      />
                      <ZoomablePreview
                        title="Reference and reconstruction comparison"
                        className="min-h-[300px] sm:min-h-[460px] lg:h-[min(70vh,800px)]"
                        toolbarStart={
                          <span className="text-xs text-muted-foreground">
                            Page 8 reference + reconstructed vectors
                          </span>
                        }
                        stageClassName="bg-muted/40"
                        resetKey="comparison"
                      >
                        <div className="grid h-full min-h-0 w-full grid-cols-1 grid-rows-1 place-items-center">
                          <img
                            src={REFERENCE}
                            alt="Original raster map on page 8 of the Rainforest to Rockies guidelines"
                            draggable={false}
                            className="col-start-1 row-start-1 h-full min-h-0 w-full object-contain"
                            onError={() => setReferenceFailed(true)}
                          />
                          <img
                            src={overlayUrl}
                            alt="Reconstructed vector map overlaid on the reference"
                            draggable={false}
                            className="col-start-1 row-start-1 h-full min-h-0 w-full object-contain"
                            style={{ opacity: overlay / 100 }}
                          />
                        </div>
                      </ZoomablePreview>
                    </>
                  ) : (
                    <div className="grid min-w-0 gap-3 md:grid-cols-2">
                      <PicturePreview
                        title={isGeographic ? 'Page 8 style reference' : 'Original page 8 map'}
                        src={REFERENCE}
                        alt="Original raster map extracted from the supplied guidelines"
                        className="min-h-[320px] sm:min-h-[400px] lg:h-[min(60vh,650px)]"
                        toolbarStart={<span className="text-xs text-muted-foreground">Original raster</span>}
                      />
                      <SvgPreview
                        svg={mapSvg}
                        title={mapTitle}
                        resetKey={`side-by-side-${geometry}`}
                        className="min-h-[320px] sm:min-h-[400px] lg:h-[min(60vh,650px)]"
                      />
                    </div>
                  )}
                  {referenceFailed && (
                    <p role="alert" className="text-sm text-danger">
                      The page 8 reference image could not be loaded. The vector reconstruction is still available in
                      the Map view.
                    </p>
                  )}
                  <p className="text-xs leading-5 text-muted-foreground">
                    The reference is the original raster extracted from the supplied guidelines. The download contains
                    the reconstructed vector map only. Use the viewer’s zoom to inspect individual details.
                  </p>
                </>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
