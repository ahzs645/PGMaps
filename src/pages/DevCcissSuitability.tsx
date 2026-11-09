import { Sprout } from 'lucide-react'
import { useCallback, useState } from 'react'
import { ForestryBackLink } from '@/components/dev/ForestryBackLink'
import { MapSectionLayout, MAP_SIDEBAR_CLASS } from '@/components/layout/MapSectionLayout'
import type { CategoricalRasterPick, CategoricalRasterStatus } from '@/components/ui/map-categorical-raster'
import { MapSidebarShell } from '@/components/ui/map-panels'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { AboutSection, AnalysesSection } from './cciss/AnalysesSection'
import { AnalysisDialogs } from './cciss/AnalysisDialogs'
import { CcissMap, type CcissOverlay } from './cciss/CcissMap'
import { InspectSection } from './cciss/InspectSection'
import {
  DEFAULT_CCISS_SELECTION,
  ccissMapOptions,
  normalizeCcissSelection,
  type CcissLayerSelection,
} from './cciss/layers'
import { MapLayerSection } from './cciss/MapLayerSection'
import { ccissPreparedMapProduct, ccissSourceOptions, type CcissRenderSource } from './cciss/mapSources'
import { RasterFilesSection } from './cciss/RasterFilesSection'
import { useCcissWorkspace, usePublishedTiles } from './cciss/useCcissWorkspace'
import { useComparisonSnapshots } from './cciss/useComparisonSnapshots'
import { useRasterSample, useRasterSource } from './cciss/useRasterSource'
import type { CcissTraceMethod } from './cciss/workspace'

const REFERENCE_BGC = '/data/cciss/reference-bgc-1961-1990.tif'

export default function DevCcissSuitability() {
  useDocumentTitle('CCISS suitability · PGMaps')
  const workspace = useCcissWorkspace()
  const { initial, point, setPoint, selection, renderSource, traceMethod, setAnalysis } = workspace
  const comparisons = useComparisonSnapshots()
  const [bgcFile, setBgcFile] = useState<File | null>(null)
  const [suitabilityFile, setSuitabilityFile] = useState<File | null>(null)
  const [polygonStatus, setPolygonStatus] = useState<CategoricalRasterStatus>({
    state: 'loading',
    message: 'Loading polygons…',
  })
  const [pick, setPick] = useState<CategoricalRasterPick | null>(null)

  const mapProduct = ccissPreparedMapProduct(selection)
  const bgcRaster = useRasterSource(bgcFile, REFERENCE_BGC)
  const suitabilityRaster = useRasterSource(
    suitabilityFile,
    mapProduct?.numeric.url ?? null,
    mapProduct?.numeric.fallbackUrl,
  )
  const bgc = useRasterSample(bgcRaster.image, point)
  const suitability = useRasterSample(suitabilityRaster.image, point)
  const tiles = usePublishedTiles(selection, renderSource === 'tiles')
  const sources = ccissSourceOptions(selection, {
    localRaster: Boolean(suitabilityFile),
    numericRasterLoaded: Boolean(suitabilityRaster.image),
    publishedTilesAvailable: tiles.available ?? undefined,
  })
  const selectedSource = sources.find((source) => source.id === renderSource)!
  const polygonLayer = selectedSource.available && (renderSource === 'vector' || renderSource === 'trace')
  const trace = renderSource === 'trace'

  const overlay: CcissOverlay = polygonLayer
    ? {
        kind: 'polygons',
        trace,
        manifestUrl: trace
          ? traceMethod === 'grid'
            ? mapProduct!.gridTraceManifest!
            : mapProduct!.pixelTraceManifest!
          : mapProduct!.vectorManifest!,
      }
    : selectedSource.available && renderSource === 'native'
      ? suitabilityRaster.image && { kind: 'native', image: suitabilityRaster.image, tileId: tiles.tileId }
      : renderSource === 'tiles' && tiles.available
        ? { kind: 'tiles', tileId: tiles.tileId }
        : null

  // A pick belongs to the polygons it came from; any change of layer or source clears it.
  const updateSelection = (patch: Partial<CcissLayerSelection>) => {
    workspace.setSelection((previous) => normalizeCcissSelection({ ...previous, ...patch }))
    setPick(null)
  }
  const changeSource = (source: CcissRenderSource) => {
    workspace.setRenderSource(source)
    setPick(null)
  }
  const changeTraceMethod = (method: CcissTraceMethod) => {
    workspace.setTraceMethod(method)
    setPick(null)
  }
  const pickPolygon = useCallback(
    (picked: CategoricalRasterPick) => {
      setPoint([picked.longitude, picked.latitude])
      setPick(picked)
    },
    [setPoint],
  )
  const openComparison = useCallback(() => setAnalysis('compare'), [setAnalysis])

  const sidebar = (
    <MapSidebarShell
      title="CCISS suitability"
      subtitle="Tile trace · numeric reference lookup"
      icon={Sprout}
      actions={<ForestryBackLink />}
      density="compact"
      className={MAP_SIDEBAR_CLASS}
    >
      <AnalysesSection onOpen={setAnalysis} comparisonCount={comparisons.snapshots.length} />
      <MapLayerSection
        selection={selection}
        onSelectionChange={updateSelection}
        onResetSelection={() => {
          workspace.setSelection(DEFAULT_CCISS_SELECTION)
          setPick(null)
        }}
        sources={sources}
        renderSource={renderSource}
        onRenderSourceChange={changeSource}
        traceMethod={traceMethod}
        onTraceMethodChange={changeTraceMethod}
        polygonLayer={polygonLayer}
        polygonStatus={polygonStatus}
        numericLayer={mapProduct !== null}
        numericRaster={{ loaded: Boolean(suitabilityRaster.image), missing: suitabilityRaster.missing }}
        localRasterSelected={Boolean(suitabilityFile)}
        tiles={tiles}
        comparisonOpenByDefault={initial.renderSource === 'tiles' || initial.renderSource === 'native'}
      />
      <InspectSection
        point={point}
        trace={trace}
        polygonLayer={polygonLayer}
        numericLayer={mapProduct !== null}
        limits={mapProduct?.limits ?? null}
        productLabel={mapProduct?.label ?? null}
        localFileName={suitabilityFile?.name ?? null}
        suitability={suitability}
        bgc={bgc}
        pick={pick}
      />
      <RasterFilesSection
        bgcFile={bgcFile}
        suitabilityFile={suitabilityFile}
        onBgcFile={setBgcFile}
        onSuitabilityFile={(file) => {
          setSuitabilityFile(file)
          if (renderSource === 'vector') workspace.setRenderSource('native')
          setPick(null)
        }}
        onReset={() => {
          setSuitabilityFile(null)
          setBgcFile(null)
          setPick(null)
        }}
        bgcError={bgcRaster.error}
        suitabilityError={suitabilityRaster.error}
        sources={{
          bgc: bgcRaster.origin ? (bgcFile?.name ?? 'PGMaps reference snapshot') : null,
          suitability: suitabilityRaster.origin ? (suitabilityFile?.name ?? mapProduct?.label ?? null) : null,
        }}
      />
      <AboutSection />
    </MapSidebarShell>
  )

  return (
    <MapSectionLayout
      desktopSidebarWidth={410}
      mobilePeekTitle="CCISS suitability"
      mobilePeekSubtitle="Tile trace and numeric reference lookup"
      sidebar={sidebar}
    >
      <CcissMap
        camera={initial.camera}
        overlay={overlay}
        selection={selection}
        statisticCount={ccissMapOptions(selection).statistics.length}
        point={point}
        onPointChange={setPoint}
        onPickPolygon={pickPolygon}
        onPolygonStatus={setPolygonStatus}
      />
      <AnalysisDialogs
        mode={workspace.analysis}
        point={point}
        onPointChange={setPoint}
        comparisons={comparisons}
        onOpenComparison={openComparison}
        onClose={() => setAnalysis(null)}
      />
    </MapSectionLayout>
  )
}
