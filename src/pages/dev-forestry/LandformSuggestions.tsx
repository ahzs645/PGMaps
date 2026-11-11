import { NativeSelect } from '@/components/ui/form-field'
import { useEffect, useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { withBase } from '@/lib/dataUrl'
import { downloadText } from '@/lib/download'
import type { ForestryScene } from './scene'
import type { BcSensitivityUnit } from './bcVisualInventory'
import { metersPerDegree, polygonBounds } from './visibility'
import { nearestLandformCandidates, nearestLandformsAlongRoad } from './landformCandidates'
import { loadVisualInventorySnapshot, VISUAL_INVENTORY_PATH } from './visualInventorySnapshot'
import { DEFAULT_LOCALE } from '@/lib/format'
import { formatKm } from './measureFormat'

export function LandformSuggestions({
  scene,
  onShow,
  onAdopt,
}: {
  scene: ForestryScene
  onShow: (unit: BcSensitivityUnit) => void
  onAdopt: (unit: BcSensitivityUnit) => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [searchMode, setSearchMode] = useState<'road' | 'block'>('road')
  const [blockId, setBlockId] = useState('')
  const [shownId, setShownId] = useState<string | null>(null)
  const blocks = scene.targets.filter((t) => t.role === 'block')
  const selected = blocks.find((b) => b.id === blockId) ?? blocks[0]
  const b = selected ? polygonBounds(selected.geometry) : null
  const lng = b ? (b[0] + b[2]) / 2 : scene.viewpoint.coordinates[0]?.[0]
  const lat = b ? (b[1] + b[3]) / 2 : scene.viewpoint.coordinates[0]?.[1]
  const road = scene.viewpoint.coordinates
  const useRoad = searchMode === 'road' && road.length > 1
  const searchPoints = useRoad ? road : Number.isFinite(lng) && Number.isFinite(lat) ? [[lng, lat]] : []
  const [west, south, east, north] = searchPoints.reduce(
    ([w, s, e, n], [x, y]) => [Math.min(w, x), Math.min(s, y), Math.max(e, x), Math.max(n, y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
  const hasAnchor = searchPoints.length > 0
  const tooLarge = useRoad && (east - west > 1.5 || north - south > 1.5 || road.length > 5000)
  const request = useMemo(() => {
    if (!hasAnchor || tooLarge) return null
    const scale = metersPerDegree(Math.max(Math.abs(south), Math.abs(north))),
      dx = 25000 / scale.lng,
      dy = 25000 / scale.lat
    return { bounds: [west - dx, south - dy, east + dx, north + dy] as [number, number, number, number], attempt }
  }, [hasAnchor, tooLarge, west, east, south, north, attempt])
  const [state, setState] = useState<{
    request: typeof request
    data: Awaited<ReturnType<typeof loadVisualInventorySnapshot>> | null
    error: string | null
  } | null>(null)
  const data = state?.request === request ? (state?.data ?? null) : null
  const error = state?.request === request ? (state?.error ?? null) : null
  useEffect(() => {
    if (!request) return
    let cancelled = false
    loadVisualInventorySnapshot(request.bounds)
      .then((value) => {
        if (!cancelled) setState({ request, data: value, error: null })
      })
      .catch((e) => {
        if (!cancelled) setState({ request, data: null, error: String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [request])
  const candidates = useMemo(
    () =>
      data && hasAnchor && !tooLarge
        ? useRoad
          ? nearestLandformsAlongRoad(data.units, road)
          : nearestLandformCandidates(data.units, { lng, lat })
        : [],
    [data, hasAnchor, tooLarge, useRoad, road, lng, lat],
  )
  const downloadNearby = () => {
    if (!data) return
    const collection = {
      type: 'FeatureCollection',
      metadata: {
        source: data.manifest.source,
        retrievedAt: data.manifest.retrievedAt,
        scope: 'Inventory bounding boxes intersecting the 25 km search envelope; candidate boundaries only',
      },
      features: data.units.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties })),
    }
    downloadText(JSON.stringify(collection), 'bc-nearby-visual-inventory.geojson', 'application/geo+json')
  }
  return (
    <CollapsibleSection
      label="Find a landform in the BC inventory"
      toggleProps={{ 'data-forestry-disclosure': 'inventory-landforms' }}
      className="rounded-lg border text-xs"
      contentClassName="space-y-2 px-3 pb-3"
    >
      <p className="text-muted-foreground">
        Nearby BC inventory boundaries are suggestions. Proximity does not establish visibility. Review the hillside
        from the road before using one as the assessment landform.
      </p>
      {road.length > 1 && (
        <label className="block">
          Search area
          <NativeSelect
            aria-label="Landform search area"
            className="my-1 w-full rounded border bg-background p-1"
            value={searchMode}
            onChange={(e) => setSearchMode(e.target.value as 'road' | 'block')}
          >
            <option value="road">Whole road corridor</option>
            <option value="block">Selected cutblock centre</option>
          </NativeSelect>
        </label>
      )}
      {!useRoad && blocks.length > 1 && (
        <label className="block">
          Search near cutblock
          <NativeSelect
            aria-label="Landform search cutblock"
            className="my-1 w-full rounded border bg-background p-1"
            value={selected?.id}
            onChange={(e) => setBlockId(e.target.value)}
          >
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                {block.name}
              </option>
            ))}
          </NativeSelect>
        </label>
      )}
      {!hasAnchor ? (
        <p>Add a cutblock or road to find nearby boundaries automatically.</p>
      ) : (
        <p>
          Within 25 km of{' '}
          {useRoad
            ? 'the whole road, including between its vertices'
            : selected
              ? `${selected.name}’s map centre`
              : 'the viewpoint'}
          ; nearest polygon edge first. Choose one to show its boundary.
        </p>
      )}
      {tooLarge && (
        <InlineAlert tone="error">
          Split this road into sections under 1.5° extent and 5,000 vertices for a whole-corridor search.
        </InlineAlert>
      )}
      {hasAnchor && !tooLarge && !data && !error && <InlineAlert loading>Loading downloaded BC inventory…</InlineAlert>}
      {error && (
        <InlineAlert tone="error" title="Inventory snapshot unavailable">
          <p>Draw or import a landform, or retry.</p>
          <Button
            variant="outline"
            size="sm"
            className="my-2 text-foreground touch:h-10"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry inventory download
          </Button>
          <p className="break-words">{error}</p>
        </InlineAlert>
      )}
      {data && hasAnchor && !tooLarge && !candidates.length && (
        <p>
          No mapped sensitivity units within 25 km. Draw or import the visible landform; a more distant unit would not
          establish coverage here.
        </p>
      )}
      {candidates.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-md border" aria-label="Inventory landform candidates">
          {candidates.map(({ unit, distanceMeters }) => {
            const shown = shownId === unit.id
            const title = `${unit.name} · ${
              distanceMeters < 1
                ? useRoad
                  ? 'intersects road'
                  : 'contains search point'
                : `${formatKm(distanceMeters, 1)} away`
            }`
            return (
              <li key={unit.id}>
                <ResultRow
                  className="py-2"
                  title={title}
                  subtitle={`${
                    unit.objectiveId
                      ? `Established: ${unit.objectiveId}`
                      : unit.recommendedId
                        ? `Recommended only: ${unit.recommendedId}`
                        : 'No objective recorded'
                  } · VAC ${unit.vac ?? 'unrated'}`}
                  leading={<MapPin className="mt-1 size-3 text-muted-foreground" aria-hidden="true" />}
                  selected={shown}
                  aria-label={`Show boundary: ${title}`}
                  onClick={() => {
                    setShownId(unit.id)
                    onShow(unit)
                  }}
                />
                {shown && (
                  <ResultRowDetail>
                    <Button size="sm" className="touch:h-10" onClick={() => onAdopt(unit)}>
                      Use candidate
                    </Button>
                  </ResultRowDetail>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {data && (
          <Button variant="outline" size="sm" className="touch:h-10" onClick={downloadNearby}>
            Download nearby inventory (GeoJSON)
          </Button>
        )}
        <Button asChild variant="outline" size="sm" className="touch:h-10">
          <a href={withBase(VISUAL_INVENTORY_PATH)} download="bc-visual-inventory-manifest.json">
            BC snapshot manifest
          </a>
        </Button>
      </div>
      {data && (
        <p className="text-muted-foreground">
          {data.manifest.featureCount.toLocaleString(DEFAULT_LOCALE)} units · original boundary coordinates. Downloaded{' '}
          {data.manifest.retrievedAt.slice(0, 10)}; source records may be older. Static snapshot; inventory gaps and
          unrated areas remain.
        </p>
      )}
    </CollapsibleSection>
  )
}
