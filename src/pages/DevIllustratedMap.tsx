import { useDeferredValue, useMemo, useState } from 'react'
import { Download, Layers, Map, RotateCcw, ScanEye, Shapes, Trees, Waves } from 'lucide-react'

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
import {
  buildElementSheetSvg,
  buildElementSvg,
  buildHatchSwatchSvg,
  buildIllustratedMapSvg,
  DEFAULT_COMPOSITION_OPTIONS,
  DEFAULT_HATCH_OPTIONS,
  ELEMENT_CATALOG,
  type CompositionOptions,
  type HatchOptions,
} from '@/lib/illustratedMap'

type View = 'map' | 'elements' | 'hatching' | 'compare'
const VIEWS: View[] = ['map', 'elements', 'hatching', 'compare']
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

function svgUrl(svg: string) {
  return `data:${SVG_TYPE},${encodeURIComponent(svg)}`
}

function SvgPreview({ svg, title, resetKey }: { svg: string; title: string; resetKey: string }) {
  const src = useMemo(() => svgUrl(svg), [svg])
  return (
    <PicturePreview
      title={title}
      src={src}
      open={() => new Blob([svg], { type: SVG_TYPE })}
      resetKey={resetKey}
      className="min-h-[300px] sm:min-h-[460px] lg:h-[min(70vh,800px)]"
      stageClassName="bg-muted/40"
      toolbarStart={<span className="text-xs text-muted-foreground">Editable SVG</span>}
    />
  )
}

export default function DevIllustratedMap() {
  const [view, setView] = useState<View>('map')
  const [hatch, setHatch] = useState<HatchOptions>({ ...DEFAULT_HATCH_OPTIONS })
  const deferredHatch = useDeferredValue(hatch)
  const [composition, setComposition] = useState<CompositionOptions>({ ...DEFAULT_COMPOSITION_OPTIONS })
  const deferredComposition = useDeferredValue(composition)
  const [layers, setLayers] = useState({ hatching: true, roads: true, symbols: true, labels: true })
  const [elementId, setElementId] = useState('all')
  const [overlay, setOverlay] = useState(50)
  const [comparisonMode, setComparisonMode] = useState('overlay')
  const [referenceFailed, setReferenceFailed] = useState(false)
  const mapSvg = useMemo(
    () => buildIllustratedMapSvg({ hatch: deferredHatch, composition: deferredComposition, layers }),
    [deferredHatch, deferredComposition, layers],
  )
  const mapUrl = useMemo(() => svgUrl(mapSvg), [mapSvg])
  const overlaySvg = useMemo(
    () =>
      view === 'compare' && comparisonMode === 'overlay'
        ? buildIllustratedMapSvg({
            hatch: deferredHatch,
            composition: deferredComposition,
            layers,
            transparentBackground: true,
          })
        : '',
    [deferredHatch, deferredComposition, layers, view, comparisonMode],
  )
  const swatchSvg = useMemo(() => buildHatchSwatchSvg(deferredHatch), [deferredHatch])
  const sheetSvg = useMemo(() => buildElementSheetSvg(), [])
  const element = ELEMENT_CATALOG.find((entry) => entry.id === elementId)
  const elementSvg = useMemo(() => (elementId === 'all' ? sheetSvg : buildElementSvg(elementId)), [elementId, sheetSvg])
  const overlayUrl = useMemo(() => svgUrl(overlaySvg), [overlaySvg])
  const currentSvg = view === 'elements' ? elementSvg : view === 'hatching' ? swatchSvg : mapSvg
  const filename =
    view === 'elements'
      ? element
        ? `rainforest-${element.id}.svg`
        : 'rainforest-elements.svg'
      : view === 'hatching'
        ? 'rainforest-hatching.svg'
        : 'rainforest-to-rockies.svg'
  const updating = deferredHatch !== hatch || deferredComposition !== composition
  const updateHatch = (key: keyof HatchOptions, value: number) =>
    setHatch((previous) => ({ ...previous, [key]: value }))

  return (
    <div className="mx-auto max-w-[1680px] space-y-6 px-4 pb-12 pt-24 sm:px-6 md:pt-10">
      <ToolPageHeader
        className="mb-0"
        back={<DevLibraryBackLink />}
        eyebrow="Illustrated map workshop"
        eyebrowIcon={Trees}
        title="Rainforest to Rockies"
        description="Explore the page 8 map as a set of constructed vector elements. Adjust the forest texture, inspect each symbol, and download the drawing."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          A schematic reconstruction of Destination BC’s reference. Positions are illustration coordinates, not a
          georeferenced map. The hatch is generated from curved bands; the symbols are built from editable geometry.
        </p>
        <Button type="button" onClick={() => downloadText(currentSvg, filename, SVG_TYPE)} disabled={updating}>
          <Download className="h-4 w-4" aria-hidden />
          Download {view === 'elements' ? 'element' : view === 'hatching' ? 'hatch' : 'map'} SVG
        </Button>
      </div>

      <TabBar<View>
        value={view}
        onChange={setView}
        idPrefix="illustrated-map"
        label="Illustrated map views"
        options={[
          { value: 'map', label: 'Map', icon: Map },
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
            <NumericRangeField
              label="Stroke spacing"
              value={hatch.spacing}
              min={1.5}
              max={12}
              step={0.1}
              unit="px"
              onChange={(value) => updateHatch('spacing', value)}
            />
            <NumericRangeField
              label="Band height"
              value={hatch.bandHeight}
              min={8}
              max={40}
              step={0.5}
              unit="px"
              onChange={(value) => updateHatch('bandHeight', value)}
            />
            <NumericRangeField
              label="Stroke width"
              value={hatch.strokeWidth}
              min={0.3}
              max={2.4}
              step={0.05}
              unit="px"
              onChange={(value) => updateHatch('strokeWidth', value)}
            />
            <NumericRangeField
              label="Band curvature"
              value={hatch.curvature}
              min={0}
              max={24}
              step={0.5}
              onChange={(value) => updateHatch('curvature', value)}
            />
            <NumberField
              label="Pattern seed"
              value={hatch.seed}
              min={0}
              max={999999}
              step={1}
              precision={0}
              updateOn="commit"
              clampOn="commit"
              onValueChange={(value) => updateHatch('seed', value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="xs" variant="outline" onClick={() => setHatch({ ...DEFAULT_HATCH_OPTIONS })}>
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
                Curves describe the coastline and roads. Trees share a branch construction, and activity symbols are
                assembled from shapes and strokes. The Elements view explains each construction.
              </p>
              <p className="text-xs leading-5 text-muted-foreground">
                Page 8 is the visual reference. Compare proportions and placement there; the reconstructed drawing is an
                editable interpretation.
              </p>
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
              {id === 'map' && view === id && <SvgPreview svg={mapSvg} title="Reconstructed map" resetKey="map" />}
              {id === 'hatching' && view === id && (
                <>
                  <SvgPreview svg={swatchSvg} title="Generated forest hatching" resetKey="hatching" />
                  <p className="text-sm leading-6 text-muted-foreground">
                    Change spacing to control density, band height to change stroke length, and curvature to change the
                    flow. The map clips this pattern to the land; it does not turn the bands to follow the boundary.
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
                        title="Reconstruction at map scale"
                        src={mapUrl}
                        alt="Current reconstructed map reduced to show the forest texture at map scale"
                        open={() => new Blob([mapSvg], { type: SVG_TYPE })}
                        className="h-60 min-h-0"
                        toolbarStart={<span className="text-xs text-muted-foreground">Reconstruction</span>}
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
                  <SelectField
                    label="Comparison mode"
                    value={comparisonMode}
                    onChange={(event) => setComparisonMode(event.target.value)}
                  >
                    <option value="overlay">Overlay reconstructed ink on page 8</option>
                    <option value="side-by-side">Original and reconstruction side by side</option>
                  </SelectField>
                  {comparisonMode === 'overlay' ? (
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
                        title="Original page 8 map"
                        src={REFERENCE}
                        alt="Original raster map extracted from the supplied guidelines"
                        className="min-h-[360px] lg:h-[min(65vh,700px)]"
                        toolbarStart={<span className="text-xs text-muted-foreground">Original raster</span>}
                      />
                      <SvgPreview svg={mapSvg} title="Reconstructed map" resetKey="side-by-side" />
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
