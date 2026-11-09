import { FORM_INPUT_CLASS, SelectField } from '@/components/ui/form-field'
import { InventorySidebar } from './InventorySidebar'
import { InventoryActions } from './InventoryActions'
import { useEffect, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { Boxes, PanelLeft } from 'lucide-react'
import { useMapTable } from '@/components/map/useMapTable'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { InlineAlert } from '@/components/ui/map-panels'
import { ReadoutGrid } from '@/components/ui/readout-grid'
import { ResultRow } from '@/components/ui/result-list'
import { TabBar } from '@/components/ui/tab-bar'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'
import type { Basemap } from '../basemaps'
import { ComparisonMap } from '../comparisons/ComparisonMap'
import { useInventoryData } from './useInventoryData'
import { useInventoryPoints } from './useInventoryPoints'
import { number } from './InventoryDetail'
import { InventoryLegend, INVENTORY_COLOUR_OPTIONS } from './InventoryLegend'
import { InventoryPoints } from './InventoryPoints'
import { StandTable, MethodTable, ReturnTable } from './InventoryTables'
import { inventoryTableSources } from './inventoryTable'
import { drawnPolygon, parseInventoryPolygon, type InventoryPolygon } from './geometry'
import {
  inventoryRows,
  summarizeInventory,
  inventoryMapFeatures,
  INVENTORY_REVIEW_COLOURS,
  INVENTORY_SELECTION_COLOUR,
  INVENTORY_SUPPORT_COLOUR,
} from './summary'
import { DEFAULT_RULES, EMPTY_REVIEW, type InventoryData, type InventoryRules, type TreeReview } from './types'
import { parseReviews, reviewManifest } from './reviews'

/** Toolbar selects sit beside `size="sm"` buttons, so they share their height. */
const TOOLBAR_SELECT_CLASS = cn(FORM_INPUT_CLASS, 'h-9 w-auto py-1')
const TOOLBAR_FIELD_CLASS = 'flex-row items-center gap-1.5'
const REVIEW_QUEUE: TreeReview['status'][] = ['unreviewed', 'split', 'merged', 'excluded', 'accepted']
const TABLE_TABS = [
  { value: 'stand', label: 'Stand & size classes' },
  { value: 'compare', label: 'Compare methods' },
  { value: 'returns', label: 'Return structure' },
  { value: 'review', label: 'Review queue' },
] as const
type TableTab = (typeof TABLE_TABS)[number]['value']

export function InventoryWorkspace({ basemap, sourceSha }: { basemap: Basemap; sourceSha?: string }) {
  const { data, error, retry } = useInventoryData(sourceSha)
  if (!data)
    return (
      <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto p-6">
        <InlineAlert
          className="w-full max-w-md"
          tone={error ? 'error' : 'info'}
          loading={!error}
          title={error ? 'Could not load the inventory' : undefined}
        >
          {error || 'Loading the completed inventory comparison…'}
        </InlineAlert>
        {error && <Button onClick={retry}>Retry inventory</Button>}
      </main>
    )
  return <InventoryViews data={data} basemap={basemap} />
}
export function InventoryViews({ data, basemap }: { data: InventoryData; basemap: Basemap }) {
  const mobile = useIsMobile()
  const [method, setMethod] = useState('foresttools-base'),
    [areaId, setAreaId] = useState(
      [...data.support.features].sort(
        (a, b) => Number(b.properties?.returns ?? 0) - Number(a.properties?.returns ?? 0),
      )[0].properties?.id as string,
    ),
    [custom, setCustom] = useState<InventoryPolygon | null>(null),
    [drawing, setDrawing] = useState(false),
    [vertices, setVertices] = useState<[number, number][]>([]),
    [message, setMessage] = useState(''),
    [selected, setSelected] = useState(''),
    [colour, setColour] = useState('height'),
    [sideTab, setSideTab] = useState('tree'),
    [tableTab, setTableTab] = useState<TableTab>('stand'),
    [showPoints, setShowPoints] = useState(!mobile),
    [panel, setPanel] = useState(!mobile),
    [rules, setRules] = useState<InventoryRules>(DEFAULT_RULES),
    [search, setSearch] = useState(''),
    [fit, setFit] = useState(0)
  const storageKey = `pgmaps-inventory-review-${data.run_id}`
  const [reviews, setReviews] = useState<Record<string, TreeReview>>(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      return stored ? parseReviews(JSON.parse(stored), data) : {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(reviewManifest(data, reviews)))
    } catch {
      setMessage('Browser storage unavailable; download the review manifest to retain changes.')
    }
  }, [reviews, data, storageKey])
  const polygon =
    custom ?? (areaId === 'all' ? null : (data.support.features.find((f) => f.properties?.id === areaId) ?? null))
  const rows = useMemo(
    () => inventoryRows(data, method, rules, reviews, polygon),
    [data, method, rules, reviews, polygon],
  )
  const active = rows.find((r) => r.tree.properties.id === selected) ?? rows[0] ?? null
  const totals = useMemo(() => summarizeInventory(rows, data, polygon, rules), [rows, data, polygon, rules])
  const features = useMemo(
    () => inventoryMapFeatures(rows, colour, active?.tree.properties.id ?? ''),
    [rows, colour, active],
  )
  const refs = useMemo<FeatureCollection>(
    () => ({
      type: 'FeatureCollection',
      features: [
        ...data.support.features.map((f) => ({
          ...f,
          properties: { ...f.properties, colour: INVENTORY_SUPPORT_COLOUR },
        })),
        ...(polygon
          ? [
              {
                ...polygon,
                properties: { id: 'Inventory selection', colour: INVENTORY_SELECTION_COLOUR, selected: true },
              },
            ]
          : []),
        ...vertices.map((p, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: p },
          properties: { id: `draw-${i}`, colour: INVENTORY_SELECTION_COLOUR },
        })),
        ...(vertices.length > 1
          ? [
              {
                type: 'Feature' as const,
                geometry: { type: 'LineString' as const, coordinates: vertices },
                properties: { id: 'Drawing boundary', colour: INVENTORY_SELECTION_COLOUR },
              },
            ]
          : []),
      ],
    }),
    [data.support, polygon, vertices],
  )
  const bounds = useMemo<[number, number, number, number]>(() => {
    if (!polygon) return data.bounds
    const c =
      polygon.geometry.type === 'Polygon' ? polygon.geometry.coordinates.flat() : polygon.geometry.coordinates.flat(2)
    return [
      Math.min(...c.map((p) => p[0])),
      Math.min(...c.map((p) => p[1])),
      Math.max(...c.map((p) => p[0])),
      Math.max(...c.map((p) => p[1])),
    ]
  }, [polygon, data.bounds])
  const centre: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2]
  const points = useInventoryPoints(data, showPoints ? (active?.tree ?? null) : null)
  const choose = (id: string) => {
    setSelected(id)
    setSideTab('tree')
    setPanel(true)
  }
  const patch = (p: Partial<InventoryRules>) => setRules((old) => ({ ...old, ...p }))
  const review = (p: Partial<TreeReview>) => {
    if (!active) return
    setReviews((old) => ({
      ...old,
      [active.tree.properties.id]: { ...EMPTY_REVIEW, ...old[active.tree.properties.id], ...p },
    }))
  }
  const file = async (selectedFile: File, kind: 'polygon' | 'reviews') => {
    try {
      if (selectedFile.size > 2_000_000) throw Error('Use a file smaller than 2 MB')
      const text = await selectedFile.text()
      if (kind === 'polygon') {
        setCustom(parseInventoryPolygon(text))
        setAreaId('custom')
        setDrawing(false)
        setVertices([])
        setSelected('')
      } else setReviews(parseReviews(JSON.parse(text), data))
      setMessage('')
    } catch (e) {
      setMessage(String(e))
    }
  }
  const finish = () => {
    try {
      setCustom(drawnPolygon(vertices))
      setAreaId('custom')
      setDrawing(false)
      setVertices([])
      setSelected('')
      setMessage('')
    } catch (e) {
      setMessage(String(e))
    }
  }
  const name = data.methods.find((m) => m.id === method)!.name
  const currentIndex = active ? rows.indexOf(active) : -1
  const tableSources = useMemo(() => inventoryTableSources(rows, name), [rows, name])
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: active?.tree.properties.id ?? null,
    onSelectRow: (row, source) => choose(source.getRowId(row)),
    // The LiDAR page writes its URL outside the router, and this map is not a shared `Map`
    // that could host `MapTableBridge`, so rows select without moving the camera.
    url: false,
    flyOnSelect: false,
    inlineButton: true,
    buttonClassName: 'text-xs',
  })
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Tree inventory workspace">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <h1 className="mr-auto text-sm font-semibold">Tree inventory</h1>
        <SelectField
          label="Method"
          aria-label="Inventory method"
          contentClassName={TOOLBAR_FIELD_CLASS}
          className={cn(TOOLBAR_SELECT_CLASS, 'max-w-[14rem]')}
          value={method}
          onChange={(e) => {
            setMethod(e.target.value)
            setSelected('')
          }}
        >
          {data.methods.map((m) => (
            <option value={m.id} key={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Area"
          aria-label="Inventory area preset"
          contentClassName={TOOLBAR_FIELD_CLASS}
          className={TOOLBAR_SELECT_CLASS}
          value={custom ? 'custom' : areaId}
          onChange={(e) => {
            setAreaId(e.target.value)
            setCustom(null)
            setVertices([])
            setDrawing(false)
            setSelected('')
          }}
        >
          <option value="all">All seven processed cores</option>
          {data.support.features.map((f) => (
            <option value={String(f.properties?.id)} key={String(f.properties?.id)}>
              Core {String(f.properties?.id)} · 0.25 ha
            </option>
          ))}
          {custom && <option value="custom">User polygon</option>}
        </SelectField>
        <SelectField
          label="Colour"
          aria-label="Inventory map colour"
          contentClassName={TOOLBAR_FIELD_CLASS}
          className={TOOLBAR_SELECT_CLASS}
          value={colour}
          onChange={(e) => setColour(e.target.value)}
        >
          {INVENTORY_COLOUR_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <Button size="sm" variant="outline" aria-pressed={panel} onClick={() => setPanel(!panel)}>
          <PanelLeft aria-hidden="true" />
          Inventory panel
        </Button>
        <Button size="sm" variant="outline" aria-pressed={showPoints} onClick={() => setShowPoints(!showPoints)}>
          <Boxes aria-hidden="true" />
          Points & profile
        </Button>
        {table.button}
      </div>
      <section
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-3 py-1.5"
        aria-label="Inventory summary"
      >
        <ReadoutGrid
          className="min-w-[16rem] flex-1"
          minColumnWidth="10rem"
          items={[
            { label: 'Candidates', value: totals.candidates },
            { label: 'Supported', title: 'Supported (processed) area', value: `${number(totals.covered_ha, 3)} ha` },
            { label: 'Density', title: 'Candidates per supported hectare', value: `${number(totals.trees_ha)} /ha` },
            totals.coverage < 0.999 && {
              label: 'Covered',
              title: 'Share of the requested area that was processed',
              value: `${number(totals.coverage * 100)}%`,
              tone: 'warning',
            },
            totals.coverage < 0.999 && {
              label: 'Unprocessed',
              value: `${number(totals.requested_ha - totals.covered_ha, 3)} ha`,
              tone: 'warning',
            },
            {
              label: 'Merch. known',
              title: 'Known modelled merchantable volume',
              value: `${number(totals.merchant_m3, 2)} m³`,
            },
            { label: 'Volume known', value: `${totals.known_volume}/${totals.candidates}` },
            { label: 'Recovered', title: 'Recovered-volume scenario', value: `${number(totals.recovered_m3, 2)} m³` },
          ]}
        />
        <Badge tone="warning">Preliminary detected candidates · not a census</Badge>
      </section>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        {panel && (
          <InventorySidebar
            data={data}
            name={name}
            sideTab={sideTab}
            setSideTab={setSideTab}
            currentIndex={currentIndex}
            rows={rows}
            choose={choose}
            active={active}
            review={review}
            rules={rules}
            patch={patch}
            totals={totals}
            search={search}
            setSearch={setSearch}
            onClose={() => setPanel(false)}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <InventoryActions
            drawing={drawing}
            setDrawing={setDrawing}
            setVertices={setVertices}
            setMessage={setMessage}
            vertices={vertices}
            finish={finish}
            file={file}
            custom={custom}
            setCustom={setCustom}
            setAreaId={setAreaId}
            setSelected={setSelected}
            fit={() => setFit((n) => n + 1)}
            rows={rows}
            data={data}
            rules={rules}
            polygon={polygon}
            reviews={reviews}
            totals={totals}
          />
          {message && (
            <div role="status" className="shrink-0 border-b p-2">
              <InlineAlert tone="warning">{message}</InlineAlert>
            </div>
          )}
          <div className="flex min-h-[180px] flex-1 flex-col overflow-y-auto md:flex-row lg:overflow-hidden">
            <div className="relative min-h-[180px] min-w-[150px] flex-1 overflow-hidden">
              <ComparisonMap
                label="Tree inventory crown map"
                centre={centre}
                bounds={bounds}
                focusKey={`inventory-${areaId}-${fit}`}
                zoom={20}
                view="top"
                basemap={basemap}
                features={features}
                references={refs}
                drawing={drawing}
                onMapClick={(p) => {
                  if (drawing) setVertices((v) => [...v, p])
                }}
                onFeaturePick={choose}
                overlayOpacity={0.55}
              />
              <InventoryLegend colour={colour} />
              {table.layout.bottomPane}
            </div>
            {showPoints && (
              <div className="h-[360px] w-full shrink-0 md:h-auto md:w-[38%] md:min-w-[240px] md:max-w-[420px]">
                <InventoryPoints
                  crop={points.crop}
                  error={points.error}
                  retry={points.retry}
                  basemap={basemap}
                  neural={method === 'sat' || method === 'forainet' || method.startsWith('fora-')}
                />
              </div>
            )}
          </div>
          <section
            className="flex h-[25dvh] min-h-[130px] max-h-[300px] shrink-0 flex-col overflow-hidden border-t"
            aria-label="Inventory summary tables"
          >
            <TabBar
              label="Inventory result table"
              idPrefix="inventory-table"
              variant="underline"
              className="shrink-0 px-1"
              value={tableTab}
              onChange={setTableTab}
              options={TABLE_TABS}
            />
            <div
              role="tabpanel"
              id={`inventory-table-panel-${tableTab}`}
              aria-labelledby={`inventory-table-tab-${tableTab}`}
              className="min-h-0 flex-1 overflow-auto p-2"
            >
              {tableTab === 'stand' ? (
                <StandTable rows={rows} area={totals.covered_ha} />
              ) : tableTab === 'compare' ? (
                <MethodTable data={data} method={method} rules={rules} reviews={reviews} polygon={polygon} />
              ) : tableTab === 'returns' ? (
                <ReturnTable core={points.core} polygon={polygon} />
              ) : (
                <div className="space-y-2">
                  <div className="grid overflow-hidden rounded-md border sm:grid-cols-2 lg:grid-cols-5">
                    {REVIEW_QUEUE.map((status) => (
                      <ResultRow
                        key={status}
                        className="py-2"
                        dotColor={INVENTORY_REVIEW_COLOURS[status]}
                        title={status}
                        // A string, so a zero count still shows.
                        trailing={String(rows.filter((r) => r.review.status === status).length)}
                        onClick={() => {
                          setSearch(status)
                          setSideTab('list')
                          setPanel(true)
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Select a category to open the searchable review list. Decisions, entered diameters and notes persist
                    locally and export in a source/run-scoped manifest.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
