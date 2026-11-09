import { useMemo, useState } from 'react'
import { PencilLine, Plus, Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isLoadableMappedRoad, mappedRoadKey } from './mappedRoad'
import { pathLengthM } from './mapNotes'
import { roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import type { ContextFeature, Coordinate } from './types'

/** Mapped roads a project can load, one row per permit section (or source row). */
export function loadableMappedRoads(context: readonly ContextFeature[]) {
  const groups = new Map<string, { feature: ContextFeature; lengthM: number; parts: number }>()
  for (const feature of context) {
    if (!isLoadableMappedRoad(feature)) continue
    const key = mappedRoadKey(feature)
    const lengthM = pathLengthM(feature.geometry.coordinates as Coordinate[])
    const group = groups.get(key)
    if (!group) groups.set(key, { feature, lengthM, parts: 1 })
    else {
      group.lengthM += lengthM
      group.parts += 1
      // Load from the longest part; the join picks up the others.
      if (lengthM > pathLengthM(group.feature.geometry.coordinates as Coordinate[])) group.feature = feature
    }
  }
  return [...groups.values()].sort((a, b) => a.feature.name.localeCompare(b.feature.name, 'en-CA', { numeric: true }))
}

/** A design with no road yet: peg one, sketch one, or start from a mapped road in the project. */
export function FirstRoadPanel({
  context,
  onPeg,
  onSketch,
  onLoadMappedRoad,
}: {
  context: readonly ContextFeature[]
  onPeg: () => void
  onSketch: () => void
  onLoadMappedRoad: (featureId: string) => void
}) {
  const roads = useMemo(() => loadableMappedRoads(context), [context])
  const [filter, setFilter] = useState('')
  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return roads
    return roads.filter(({ feature }) =>
      [
        feature.name,
        feature.roadEvidence?.forestFileId,
        feature.roadEvidence?.roadSectionId,
        feature.roadEvidence?.clientNumber,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    )
  }, [roads, filter])
  return (
    <RoadSection title="Add the first road" data-testid="first-road-panel">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          This design has no road yet. Peg one point by point, sketch one freehand, or load a mapped road to read its
          profile on this terrain.
        </p>
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" className="gap-1 px-1" onClick={onPeg}>
            <Plus className="size-3" /> Peg road
          </Button>
          <Button size="sm" variant="outline" className="gap-1 px-1" onClick={onSketch}>
            <PencilLine className="size-3" /> Sketch road
          </Button>
        </div>
        {roads.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">Mapped roads in this project · {roads.length}</p>
            {roads.length > 6 && (
              <input
                type="search"
                aria-label="Filter mapped roads"
                placeholder="Filter by name, permit or section"
                className={roadFieldClass}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
            )}
            <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Mapped roads to load">
              {shown.map(({ feature, lengthM, parts }) => (
                <li key={feature.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1">
                  <div className="min-w-0 text-xs">
                    <div className="truncate font-medium">{feature.name}</div>
                    <div className="text-muted-foreground tabular-nums">
                      {lengthM >= 1000 ? `${(lengthM / 1000).toFixed(2)} km` : `${Math.round(lengthM)} m`}
                      {parts > 1 ? ` · ${parts} parts` : ''}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                    aria-label={`Load ${feature.name} as a road`}
                    onClick={() => onLoadMappedRoad(feature.id)}
                  >
                    <Route className="size-3" /> Load
                  </Button>
                </li>
              ))}
              {!shown.length && <li className="text-xs text-muted-foreground">No mapped road matches.</li>}
            </ul>
          </div>
        )}
      </div>
    </RoadSection>
  )
}
