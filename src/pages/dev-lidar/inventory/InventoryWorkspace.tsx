import { InventorySidebar } from './InventorySidebar'
import { InventoryActions } from './InventoryActions'
import { useEffect, useMemo, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { Basemap } from '../basemaps'
import { ComparisonMap } from '../comparisons/ComparisonMap'
import { useInventoryData } from './useInventoryData'
import { useInventoryPoints } from './useInventoryPoints'
import { number } from './InventoryDetail'
import { InventoryPoints } from './InventoryPoints'
import { StandTable, MethodTable, ReturnTable } from './InventoryTables'
import { drawnPolygon, parseInventoryPolygon, type InventoryPolygon } from './geometry'
import { inventoryRows, summarizeInventory, inventoryMapFeatures } from './summary'
import { DEFAULT_RULES, EMPTY_REVIEW, type InventoryData, type InventoryRules, type TreeReview } from './types'
import { parseReviews, reviewManifest } from './reviews'
export function InventoryWorkspace({ basemap, sourceSha }: { basemap: Basemap; sourceSha?: string }) {
  const { data, error, retry } = useInventoryData(sourceSha)
  if (!data)
    return (
      <main className="p-6 text-sm" role="status">
        {error || 'Loading the completed inventory comparison…'}
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
    [tableTab, setTableTab] = useState('stand'),
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
        ...data.support.features.map((f) => ({ ...f, properties: { ...f.properties, colour: '#94a3b8' } })),
        ...(polygon
          ? [{ ...polygon, properties: { id: 'Inventory selection', colour: '#e11d48', selected: true } }]
          : []),
        ...vertices.map((p, i) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: p },
          properties: { id: `draw-${i}`, colour: '#e11d48' },
        })),
        ...(vertices.length > 1
          ? [
              {
                type: 'Feature' as const,
                geometry: { type: 'LineString' as const, coordinates: vertices },
                properties: { id: 'Drawing boundary', colour: '#e11d48' },
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
  const file = async (event: React.ChangeEvent<HTMLInputElement>, kind: 'polygon' | 'reviews') => {
    const selectedFile = event.target.files?.[0]
    event.target.value = ''
    if (!selectedFile) return
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
  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Tree inventory workspace">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <h1 className="mr-auto font-semibold">Tree inventory</h1>
        <label>
          Method{' '}
          <select
            aria-label="Inventory method"
            className="max-w-[230px] rounded border bg-background p-1"
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
          </select>
        </label>
        <label>
          Area{' '}
          <select
            aria-label="Inventory area preset"
            className="rounded border bg-background p-1"
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
          </select>
        </label>
        <label>
          Colour{' '}
          <select
            aria-label="Inventory map colour"
            className="rounded border bg-background p-1"
            value={colour}
            onChange={(e) => setColour(e.target.value)}
          >
            {[
              ['height', 'Height'],
              ['species', 'Species assumption'],
              ['dbh', 'Estimated / entered DBH'],
              ['volume', 'Modelled total volume'],
              ['texture', 'Crown texture'],
              ['review', 'Review status'],
            ].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="outline" onClick={() => setPanel(!panel)}>
          {panel ? 'Hide' : 'Show'} inventory panel
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowPoints(!showPoints)}>
          {showPoints ? 'Hide' : 'Show'} points & profile
        </Button>
      </div>
      <div
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b bg-emerald-50 px-3 py-1.5 text-[11px] dark:bg-emerald-950"
        aria-label="Inventory summary"
      >
        <strong>
          {totals.candidates} candidates · {number(totals.covered_ha, 3)} supported ha
        </strong>
        <span>{number(totals.trees_ha)} candidates/ha</span>
        {totals.coverage < 0.999 && (
          <span className="font-medium text-amber-800 dark:text-amber-300">
            {number(totals.coverage * 100)}% covered · {number(totals.requested_ha - totals.covered_ha, 3)} ha
            unprocessed
          </span>
        )}
        <span>Known modelled merchantable: {number(totals.merchant_m3, 2)} m³</span>
        <span>
          Volume available {totals.known_volume}/{totals.candidates}
        </span>
        <span>Recovered scenario: {number(totals.recovered_m3, 2)} m³</span>
        <Badge tone="warning">Preliminary detected candidates · not a census</Badge>
      </div>
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
            <p role="status" className="shrink-0 bg-amber-50 p-2 text-xs dark:bg-amber-950">
              {message}
            </p>
          )}
          <div className="flex min-h-[180px] flex-1 flex-col overflow-y-auto md:flex-row lg:overflow-hidden">
            <div className="relative min-h-[180px] min-w-[150px] flex-1">
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
              <p className="pointer-events-none absolute bottom-8 left-2 right-12 rounded bg-background/90 p-1.5 text-[10px]">
                {colour === 'species'
                  ? 'Species assumptions: spruce green · aspen orange · birch magenta · Douglas-fir blue · unknown grey.'
                  : colour === 'review'
                    ? 'Review: accepted green · excluded red · split orange · merged purple · unreviewed grey.'
                    : `Pale → dark: ${colour === 'height' ? '0–40 m height' : colour === 'dbh' ? '0–80 cm DBH' : colour === 'volume' ? '0–3 m³ modelled total stem' : '0–8 GLCM entropy (ForestTools only)'}. Grey = unavailable.`}{' '}
                Red outline = selection boundary. Counts use canopy-apex membership, not fractional crowns.
              </p>
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
            <div className="shrink-0 border-b px-2 py-1">
              <SegmentedControl
                label="Inventory result table"
                size="sm"
                fullWidth={false}
                value={tableTab}
                onChange={setTableTab}
                options={[
                  { value: 'stand', label: 'Stand & size classes' },
                  { value: 'compare', label: 'Compare methods' },
                  { value: 'returns', label: 'Return structure' },
                  { value: 'review', label: 'Review queue' },
                ]}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {tableTab === 'stand' ? (
                <StandTable rows={rows} area={totals.covered_ha} />
              ) : tableTab === 'compare' ? (
                <MethodTable data={data} method={method} rules={rules} reviews={reviews} polygon={polygon} />
              ) : tableTab === 'returns' ? (
                <ReturnTable core={points.core} polygon={polygon} />
              ) : (
                <div className="flex flex-wrap gap-2 text-xs">
                  {['unreviewed', 'split', 'merged', 'excluded', 'accepted'].map((status) => (
                    <Button
                      size="sm"
                      variant="outline"
                      key={status}
                      onClick={() => {
                        setSearch(status)
                        setSideTab('list')
                        setPanel(true)
                      }}
                    >
                      {status}: {rows.filter((r) => r.review.status === status).length}
                    </Button>
                  ))}
                  <p className="w-full text-[10px]">
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
