import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import { Download, FileText } from 'lucide-react'
import { MapTableBridge, defineTableSource, useMapTable } from '@/components/map/useMapTable'
import { numberColumn, textColumn } from '@/components/map/tableColumns'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { Map } from '@/components/ui/map'
import { MapGeoJsonLayer } from '@/components/ui/map-layers'
import {
  InlineAlert,
  KeyValueRows,
  MapGradientLegendItem,
  MapLegendNote,
  MapLegendPanel,
  SidebarSection,
} from '@/components/ui/map-panels'
import { ShareBars } from '@/components/ui/share-bars'
import { StatGroup } from '@/components/ui/stat-group'
import { ExternalLink, TextButton } from '@/components/ui/text-button'
import { ToggleRow } from '@/components/ui/toggle-row'
import { DEFAULT_LOCALE } from '@/lib/format'
import type { Basemap } from '../basemaps'
import { LidarToolLayout } from '../LidarToolLayout'
import { LIDAR_BASE } from '../workspaceTools'
import {
  estimatedBytes,
  formatBytes,
  LIDAR_BC_PORTAL,
  LIDAR_BC_PRODUCTS,
  detailField,
  NO_FILTER,
  storedFile,
  YEAR_STOPS,
  yearColorExpression,
  type LidarBcProduct,
  type LidarBcProductId,
  type LidarBcTile,
  type LonLatBounds,
  type TileFilter,
} from '@/lib/lidar/bcLidarIndex'
import {
  isCapped,
  useLidarBcBreakdown,
  useLidarBcCoverage,
  useLidarBcViewTiles,
  useLidarBcYearCounts,
} from './useBcLidarIndex'

const SATELLITE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Tiles © Esri — Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    },
  },
  layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
}
const BLANK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f1f5f9' } }],
}
const STYLES: Record<Basemap, { light: StyleSpecification; dark: StyleSpecification } | undefined> = {
  vector: undefined,
  satellite: { light: SATELLITE_STYLE, dark: SATELLITE_STYLE },
  none: { light: BLANK_STYLE, dark: BLANK_STYLE },
}
const BC_CENTRE: [number, number] = [-125.4, 54.6]
const count = (n: number) => n.toLocaleString(DEFAULT_LOCALE)
const tilesText = (n: number) => `${count(n)} ${n === 1 ? 'tile' : 'tiles'}`

type TileFeature = Feature<Geometry, LidarBcTile>

function positions(geometry: Geometry): Position[] {
  if (geometry.type === 'Polygon') return geometry.coordinates.flat()
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat(2)
  return []
}
function tileCentre(feature: TileFeature): [number, number] {
  const points = positions(feature.geometry)
  if (!points.length) return BC_CENTRE
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2]
}

function tableColumns(product: LidarBcProduct) {
  return [
    textColumn<TileFeature>('tile', 'Map tile', (row) => row.properties.maptile),
    numberColumn<TileFeature>('year', 'Year', (row) => row.properties.year),
    textColumn<TileFeature>('project', 'Project', (row) => row.properties.oper_name ?? null),
    product.id === 'pointcloud'
      ? numberColumn<TileFeature>('density', 'Density (pts/m²)', (row) => row.properties.density ?? null)
      : textColumn<TileFeature>('spacing', 'Cell size', (row) => row.properties.spacing ?? null),
    textColumn<TileFeature>('projection', 'Projection', (row) => row.properties.projection ?? null),
    textColumn<TileFeature>('file', 'File', (row) => storedFile(product, row.properties).url),
  ]
}

/**
 * Where BC has LiDAR, which products and grids cover a place, and the files to download, read live
 * from the province's tile index. Files are links only: their host allows no cross-site reads.
 */
export function CoverageWorkspace({ basemap }: { basemap: Basemap }) {
  const [productId, setProductId] = useState<LidarBcProductId>('pointcloud')
  const [filter, setFilter] = useState<TileFilter>(NO_FILTER)
  const year = filter.year
  const changeFilter = (change: Partial<TileFilter>) => {
    setFilter((previous) => ({ ...previous, ...change }))
    setSelected(null)
  }
  const [view, setView] = useState<{ bounds: LonLatBounds; zoom: number } | null>(null)
  const [selected, setSelected] = useState<TileFeature | null>(null)
  const [sheetCollapse, setSheetCollapse] = useState(0)
  const sidebar = useRef<HTMLSpanElement>(null)
  const selectedId = selected?.properties.OBJECTID
  // A picked tile's card heads the sidebar; bring it into view.
  useEffect(() => {
    if (selectedId != null)
      sidebar.current?.parentElement?.querySelector('[data-map-sidebar-scroll]')?.scrollTo({ top: 0 })
  }, [selectedId])
  const product = LIDAR_BC_PRODUCTS.find((item) => item.id === productId)!
  const coverage = useLidarBcCoverage()
  const years = useLidarBcYearCounts(LIDAR_BC_PRODUCTS)
  const inView = useLidarBcViewTiles(product, view, filter)
  const breakdown = useLidarBcBreakdown(product, filter)
  const total = years.counts[product.id]?.reduce((sum, row) => sum + row.tiles, 0)
  const pointCloud = detailField(product) === 'density'
  const detailLabel = breakdown.details?.find((row) => row.key === filter.detail)?.label
  const shownCoverage = useMemo<FeatureCollection | null>(() => {
    if (!coverage.data || year == null) return coverage.data
    return { ...coverage.data, features: coverage.data.features.filter((f) => Number(f.properties?.YEAR_) === year) }
  }, [coverage.data, year])
  const tiles = useMemo(() => (inView.tiles?.features ?? []) as TileFeature[], [inView.tiles])
  const selectedCollection = useMemo<FeatureCollection | null>(
    () => (selected ? { type: 'FeatureCollection', features: [selected] } : null),
    [selected],
  )
  const choose = (feature: TileFeature | undefined) => {
    setSelected(feature ?? null)
    if (feature) setSheetCollapse((n) => n + 1)
  }
  const tableSources = useMemo(
    () =>
      tiles.length
        ? [
            defineTableSource<TileFeature>({
              id: 'tiles',
              label: `${product.label} tiles in view`,
              shape: 'fill',
              rows: tiles,
              columns: tableColumns(product),
              getRowId: (row) => String(row.properties.OBJECTID),
              getRowCenter: tileCentre,
              exportFileName: `bc-lidar-${product.id}-tiles`,
            }),
          ]
        : [],
    [tiles, product],
  )
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: selected ? String(selected.properties.OBJECTID) : null,
    onSelectRow: (row) => choose(row as TileFeature),
    url: false,
    inlineButton: true,
  })
  const viewBytes = inView.count == null ? null : estimatedBytes(product, inView.count)
  const file = selected ? storedFile(product, selected.properties) : null
  const drawing = view != null && view.zoom >= product.minZoom

  return (
    <LidarToolLayout
      toolId="coverage"
      sidebarRef={sidebar}
      label="BC LiDAR coverage map"
      table={table}
      collapseSheetKey={sheetCollapse}
      mobilePeekSubtitle={
        inView.count == null
          ? `${product.label} · ${product.grid}`
          : `${tilesText(inView.count)} in view · ${product.label} ${product.grid}`
      }
      sidebar={
        <>
          {selected && file && (
            <SidebarSection
              title={`Tile ${selected.properties.maptile}`}
              subtitle={`${product.label} · ${product.grid}`}
              actions={
                <TextButton onClick={() => setSelected(null)} aria-label="Clear selected tile">
                  Clear
                </TextButton>
              }
            >
              <KeyValueRows
                rows={[
                  { label: 'Acquired', value: selected.properties.year },
                  !!selected.properties.oper_name && { label: 'Project', value: selected.properties.oper_name },
                  !!selected.properties.contract && { label: 'Contract', value: selected.properties.contract },
                  selected.properties.density != null && {
                    label: 'Point density',
                    value: `${selected.properties.density} pts/m²`,
                  },
                  !!selected.properties.spacing && { label: 'Cell size', value: selected.properties.spacing },
                  !!selected.properties.projection && { label: 'Projection', value: selected.properties.projection },
                  { label: 'Format', value: file.format },
                  product.medianBytes != null && {
                    label: 'Typical size',
                    value: `~${formatBytes(product.medianBytes)}`,
                  },
                ]}
              />
              {file.url && (
                <Button asChild size="sm" className="mt-3 w-full">
                  <a href={file.url} download>
                    <Download aria-hidden="true" />
                    Download {file.format} from LidarBC
                  </a>
                </Button>
              )}
              {file.url && file.format === 'LAZ' && (
                <p className="mt-2 text-2xs text-muted-foreground">
                  Then open it in{' '}
                  <Link className="underline underline-offset-2" to={`${LIDAR_BASE}data/`}>
                    Import &amp; data
                  </Link>
                  : a tile this size is read in chunks into a whole-tile overview, with full detail for an area you zoom
                  to.
                </p>
              )}
              {selected.properties.s3RptUrl && (
                <ExternalLink className="mt-2 flex w-fit" href={selected.properties.s3RptUrl}>
                  <FileText className="mr-1 inline size-3.5" aria-hidden="true" />
                  Accuracy report
                </ExternalLink>
              )}
              {file.corrected && (
                <p className="mt-2 text-2xs text-muted-foreground">
                  The index lists this surface model as a .tif, but it is stored as a .laz point file; the link above
                  points at the stored file.
                </p>
              )}
            </SidebarSection>
          )}
          <SidebarSection
            title="Product"
            actions={
              <InfoTip label="About the products">
                Point clouds are the original returns (LAZ). The DEM is the bare-earth surface and the DSM the top
                surface, both GeoTIFF. Each is cut to a BCGS grid: a 1:2,500 tile is about 2.6 km², a 1:10,000 tile 41
                km² and a 1:20,000 sheet 164 km². Recent LidarBC acquisitions (2023 on) use 1:2,500 tiles; older
                projects published their rasters on 1:20,000 sheets.
              </InfoTip>
            }
          >
            <div className="space-y-1.5" role="group" aria-label="LiDAR product">
              {LIDAR_BC_PRODUCTS.map((item) => {
                const tilesTotal = years.counts[item.id]?.reduce((sum, row) => sum + row.tiles, 0)
                return (
                  <ToggleRow
                    key={item.id}
                    active={item.id === productId}
                    tone="emerald"
                    label={`${item.label} · ${item.grid}`}
                    description={`${item.format} · ${tilesTotal == null ? '…' : tilesText(tilesTotal)}`}
                    trailing={
                      item.medianBytes == null ? undefined : (
                        <span className="text-2xs tabular-nums text-muted-foreground">
                          ~{formatBytes(item.medianBytes)}
                        </span>
                      )
                    }
                    onClick={() => {
                      setProductId(item.id)
                      // Densities and cell sizes differ between products; the year carries over.
                      changeFilter({ detail: null })
                    }}
                  />
                )
              })}
            </div>
            {years.error && (
              <InlineAlert tone="warning" className="mt-2">
                {years.error}
              </InlineAlert>
            )}
          </SidebarSection>
          <SidebarSection
            title="Acquisition year"
            subtitle={
              year == null
                ? total == null
                  ? undefined
                  : `${tilesText(total)} of ${product.label.toLowerCase()} in BC · select a year to filter`
                : `Showing ${year} only`
            }
            actions={
              year == null ? undefined : <TextButton onClick={() => changeFilter({ year: null })}>All years</TextButton>
            }
          >
            {breakdown.years && breakdown.years.length > 0 && (
              <ShareBars
                aria-label={`${product.label} tiles per year`}
                items={breakdown.years.map((row) => ({ key: String(row.year), label: row.year, values: [row.tiles] }))}
                max={Math.max(...breakdown.years.map((row) => row.tiles))}
                formatValue={count}
                series={[{ className: 'bg-emerald-600' }]}
                selectedKey={year == null ? null : String(year)}
                onSelect={(key) => changeFilter({ year: key == null ? null : Number(key) })}
              />
            )}
          </SidebarSection>
          <SidebarSection
            title={pointCloud ? 'Point density' : 'Cell size'}
            subtitle={
              filter.detail == null
                ? `${pointCloud ? 'Points per m²' : 'Grid cell'} of each tile${year == null ? '' : ` from ${year}`} · select one to filter`
                : `Showing ${detailLabel ?? 'one value'} only${drawing ? '' : ` · tiles draw from zoom ${product.minZoom}`}`
            }
            actions={
              filter.detail == null ? (
                <InfoTip label={pointCloud ? 'About point density' : 'About cell size'}>
                  {pointCloud
                    ? 'The density each tile was flown to, as LidarBC records it for the tile: the points per square metre of the acquisition contract, not a count of the file. Most of BC was flown at 8 pts/m²; the denser tiles are project areas flown for forestry or engineering.'
                    : 'The raster cell size LidarBC records for each tile. Rasters carry no point density: their source point clouds are listed under Point clouds. "Not stated" tiles have a blank cell size in the index.'}{' '}
                  The shaded overview at low zoom is drawn by year only, so this filter shows on the map once tiles
                  draw.
                </InfoTip>
              ) : (
                <TextButton onClick={() => changeFilter({ detail: null })}>
                  {pointCloud ? 'All densities' : 'All sizes'}
                </TextButton>
              )
            }
          >
            {breakdown.details && breakdown.details.length > 0 && (
              <ShareBars
                aria-label={`${product.label} tiles per ${pointCloud ? 'density' : 'cell size'}`}
                labelWidth="4.5rem"
                items={breakdown.details.map((row) => ({ key: row.key, label: row.label, values: [row.tiles] }))}
                max={Math.max(...breakdown.details.map((row) => row.tiles))}
                formatValue={count}
                series={[{ className: 'bg-sky-600' }]}
                selectedKey={filter.detail}
                onSelect={(key) => changeFilter({ detail: key })}
              />
            )}
            {breakdown.error && (
              <InlineAlert tone="warning" className="mt-2">
                {breakdown.error}
              </InlineAlert>
            )}
          </SidebarSection>
          <SidebarSection
            title="In this view"
            actions={
              <InfoTip label="About these sizes">
                The index lists no file sizes, and the file host blocks other sites from reading them, so the size is an
                estimate: tiles × the median {product.label.toLowerCase()} file ({product.medianNote}). Point cloud
                files vary from about 0.26 to 2.8 GB with point density and terrain.
              </InfoTip>
            }
          >
            <StatGroup
              variant="tiles"
              size="sm"
              aria-label="Tiles in this view"
              items={[
                { label: 'Tiles', value: inView.count == null ? '…' : count(inView.count) },
                {
                  label: 'Area covered',
                  value: inView.count == null ? '…' : `${count(Math.round(inView.count * product.cellKm2))} km²`,
                },
                {
                  label: 'Download size',
                  value:
                    viewBytes == null
                      ? product.medianBytes == null
                        ? 'Not measured'
                        : '…'
                      : `≈ ${formatBytes(viewBytes)}`,
                },
              ]}
            />
            {isCapped(inView) && (
              <InlineAlert tone="warning" className="mt-2">
                Showing the first {count(tiles.length)} of {count(inView.count!)} tiles. Zoom in to see them all.
              </InlineAlert>
            )}
            {inView.error && (
              <InlineAlert tone="error" className="mt-2">
                {inView.error}
              </InlineAlert>
            )}
          </SidebarSection>
          <SidebarSection
            title="Source"
            actions={
              <InfoTip label="What this page can and cannot load">
                The tile index is BC's public ArcGIS service, which allows other sites to query it, so this page reads
                it live. The files are on BC's object store, which sends no cross-site (CORS) headers: a browser can
                download them through a link but this page cannot read, preview or size them. They are also not
                cloud-optimized (the LAZ files are not COPC and the GeoTIFFs are not COG), so even with CORS they could
                not be streamed.
              </InfoTip>
            }
          >
            <p className="text-xs leading-5 text-muted-foreground">
              Tile index from LidarBC, queried live. Downloads come straight from the province.
            </p>
            <ExternalLink className="mt-2 flex w-fit text-xs" href={LIDAR_BC_PORTAL}>
              LidarBC download portal
            </ExternalLink>
          </SidebarSection>
        </>
      }
    >
      <div className="relative min-h-0 flex-1">
        <Map
          className="absolute inset-0"
          styles={STYLES[basemap]}
          center={BC_CENTRE}
          zoom={4.6}
          onMoveEnd={(state) => setView({ bounds: state.bounds, zoom: state.zoom })}
        >
          {shownCoverage && (
            <MapGeoJsonLayer
              data={shownCoverage}
              color={yearColorExpression('YEAR_')}
              fillOpacity={drawing ? 0.08 : 0.35}
              lineWidth={0.8}
              lineOpacity={0.6}
            />
          )}
          {drawing && inView.tiles && (
            <MapGeoJsonLayer
              data={inView.tiles}
              idProperty="OBJECTID"
              color={yearColorExpression('year')}
              fillOpacity={0.35}
              lineWidth={0.8}
              onFeatureClick={(id) => choose(tiles.find((t) => String(t.properties.OBJECTID) === String(id)))}
              hoverHtml={(p) =>
                [p.maptile, p.year, p.density != null ? `${p.density} pts/m²` : p.spacing]
                  .filter((part) => part != null && String(part).trim() !== '')
                  .join(' · ')
              }
            />
          )}
          {selectedCollection && (
            <MapGeoJsonLayer data={selectedCollection} color="#e11d48" fillOpacity={0} lineWidth={3} lineOpacity={1} />
          )}
          <MapTableBridge table={table} />
        </Map>
        <div className="absolute left-2 top-[calc(var(--map-mobile-toolbar-height,0px)_+_0.5rem)] z-20 md:top-2">
          {table.button}
        </div>
        {coverage.error && (
          <div className="absolute inset-x-2 top-14 z-20 md:left-2 md:right-auto md:max-w-sm">
            <InlineAlert tone="error" title="Could not load BC's LiDAR coverage">
              {coverage.error}{' '}
              <button type="button" className="underline" onClick={coverage.retry}>
                Retry
              </button>
            </InlineAlert>
          </div>
        )}
        <MapLegendPanel
          title="Acquisition year"
          description={`${product.label} · ${product.grid}${inView.loading ? ' · loading…' : ''}`}
          collapsible
          defaultCollapsed="mobile"
          width="sm"
          aria-label="BC LiDAR coverage legend"
        >
          <MapGradientLegendItem
            colors={YEAR_STOPS.map(([, colour]) => colour)}
            ticks={[String(YEAR_STOPS[0][0]), String(YEAR_STOPS[YEAR_STOPS.length - 1][0])]}
          />
          <MapLegendNote className="mt-1.5">
            {drawing ? 'Boxes are tiles; select one to download it.' : 'Shaded: LiDAR coverage. Zoom in for tiles.'}
          </MapLegendNote>
        </MapLegendPanel>
      </div>
    </LidarToolLayout>
  )
}
