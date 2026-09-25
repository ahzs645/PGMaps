import { useEffect, useMemo, useState } from 'react'
import { withBase } from '@/lib/dataUrl'
import type { ForestryScene } from './scene'
import type { BcSensitivityUnit } from './bcVisualInventory'
import { metersPerDegree, polygonBounds } from './visibility'
import { nearestLandformCandidates, nearestLandformsAlongRoad } from './landformCandidates'
import { loadVisualInventorySnapshot, VISUAL_INVENTORY_PATH } from './visualInventorySnapshot'

export function LandformSuggestions({ scene, onShow, onAdopt }: { scene: ForestryScene; onShow: (unit: BcSensitivityUnit) => void; onAdopt: (unit: BcSensitivityUnit) => void }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadVisualInventorySnapshot>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [searchMode, setSearchMode] = useState<'road' | 'block'>('road')
  const [blockId, setBlockId] = useState('')
  const blocks = scene.targets.filter(t => t.role === 'block')
  const selected = blocks.find(b => b.id === blockId) ?? blocks[0]
  const b = selected ? polygonBounds(selected.geometry) : null
  const lng = b ? (b[0] + b[2]) / 2 : scene.viewpoint.coordinates[0]?.[0]
  const lat = b ? (b[1] + b[3]) / 2 : scene.viewpoint.coordinates[0]?.[1]
  const road = scene.viewpoint.coordinates
  const useRoad = searchMode === 'road' && road.length > 1
  const searchPoints = useRoad ? road : Number.isFinite(lng) && Number.isFinite(lat) ? [[lng, lat]] : []
  const [west, south, east, north] = searchPoints.reduce(([w, s, e, n], [x, y]) =>
    [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)], [Infinity, Infinity, -Infinity, -Infinity])
  const hasAnchor = searchPoints.length > 0
  const tooLarge = useRoad && (east - west > 1.5 || north - south > 1.5 || road.length > 5000)
  useEffect(() => {
    if (!hasAnchor || tooLarge) { setData(null); return }
    let cancelled = false
    setError(null)
    setData(null)
    const scale = metersPerDegree(Math.max(Math.abs(south), Math.abs(north))), dx = 25000 / scale.lng, dy = 25000 / scale.lat
    loadVisualInventorySnapshot([west - dx, south - dy, east + dx, north + dy]).then(value => { if (!cancelled) setData(value) }).catch(e => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [hasAnchor, tooLarge, west, east, south, north, attempt])
  const candidates = useMemo(() => data && hasAnchor && !tooLarge ? (useRoad ? nearestLandformsAlongRoad(data.units, road) : nearestLandformCandidates(data.units, { lng, lat })) : [], [data, hasAnchor, tooLarge, useRoad, road, lng, lat])
  const downloadNearby = () => {
    if (!data) return
    const collection = { type: 'FeatureCollection', metadata: { source: data.manifest.source, retrievedAt: data.manifest.retrievedAt, scope: 'Inventory bounding boxes intersecting the 25 km search envelope; candidate boundaries only' }, features: data.units.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties })) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(collection)], { type: 'application/geo+json' }))
    const a = document.createElement('a'); a.href = url; a.download = 'bc-nearby-visual-inventory.geojson'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  return <details className="rounded-lg border p-3 text-xs" data-forestry-disclosure="inventory-landforms">
    <summary className="cursor-pointer font-medium">Find a landform in the BC inventory</summary>
    <p className="my-2 text-muted-foreground">Nearby BC inventory boundaries are suggestions. Proximity does not establish visibility. Review the hillside from the road before using one as the assessment landform.</p>
    {road.length > 1 && <label className="block">Search area<select aria-label="Landform search area" className="my-1 w-full rounded border bg-background p-1" value={searchMode} onChange={e => setSearchMode(e.target.value as 'road' | 'block')}><option value="road">Whole road corridor</option><option value="block">Selected cutblock centre</option></select></label>}
    {!useRoad && blocks.length > 1 && <label className="block">Search near cutblock<select aria-label="Landform search cutblock" className="my-1 w-full rounded border bg-background p-1" value={selected?.id} onChange={e => setBlockId(e.target.value)}>{blocks.map(block => <option key={block.id} value={block.id}>{block.name}</option>)}</select></label>}
    {!hasAnchor ? <p>Add a cutblock or road to find nearby boundaries automatically.</p> : <p>Within 25 km of {useRoad ? 'the whole road, including between its vertices' : selected ? `${selected.name}’s map centre` : 'the viewpoint'}; nearest polygon edge first.</p>}
    {tooLarge && <p role="alert">Split this road into sections under 1.5° extent and 5,000 vertices for a whole-corridor search.</p>}
    {hasAnchor && !tooLarge && !data && !error && <p role="status">Loading downloaded BC inventory…</p>}
    {error && <div role="alert"><p>Inventory snapshot unavailable. Draw or import a landform, or retry.</p><button className="my-2 rounded border px-2 py-1" onClick={() => setAttempt(n => n + 1)}>Retry inventory download</button><details><summary>Details</summary>{error}</details></div>}
    {data && hasAnchor && !tooLarge && !candidates.length && <p className="my-2">No mapped sensitivity units within 25 km. Draw or import the visible landform; a more distant unit would not establish coverage here.</p>}
    <ul className="my-2 space-y-2">{candidates.map(({ unit, distanceMeters }) => <li key={unit.id} className="rounded border p-2">
      <p className="font-medium">{unit.name} · {distanceMeters < 1 ? (useRoad ? 'intersects road' : 'contains search point') : `${(distanceMeters / 1000).toFixed(1)} km away`}</p>
      <p className="text-muted-foreground">{unit.objectiveId ? `Established: ${unit.objectiveId}` : unit.recommendedId ? `Recommended only: ${unit.recommendedId}` : 'No objective recorded'} · VAC {unit.vac ?? 'unrated'}</p>
      <div className="mt-1 flex gap-2"><button className="rounded border px-2 py-1" onClick={() => onShow(unit)}>Show boundary</button><button className="rounded border px-2 py-1" onClick={() => onAdopt(unit)}>Use candidate</button></div>
    </li>)}</ul>
    <div className="flex flex-wrap gap-2">{data && <button className="rounded border px-2 py-1" onClick={downloadNearby}>Download nearby inventory (GeoJSON)</button>}<a className="underline" href={withBase(VISUAL_INVENTORY_PATH)} download="bc-visual-inventory-manifest.json">BC snapshot manifest</a></div>
    {data && <p className="mt-1 text-muted-foreground">{data.manifest.featureCount.toLocaleString()} units · original boundary coordinates. Downloaded {data.manifest.retrievedAt.slice(0, 10)}; source records may be older. Static snapshot; inventory gaps and unrated areas remain.</p>}
  </details>
}
