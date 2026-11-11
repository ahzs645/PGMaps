import { useState } from 'react'
import { LocateFixed, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import { referenceShape, type ReferenceFeature, type ReferenceShape } from './referenceFeatures'
import type { DrawMode } from './PlanView'
import type { Coordinate } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

const SHAPE_LABELS: Record<ReferenceShape, string> = { point: 'Point', line: 'Line', area: 'Area' }
const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

/** A name edited in place and saved on Enter or when the field is left; an empty name is not saved. */
function ReferenceName({ name, label, onRename }: { name: string; label: string; onRename: (name: string) => void }) {
  const [draft, setDraft] = useState(name)
  const save = () => {
    const next = draft.trim()
    if (next && next !== name) onRename(next)
    else setDraft(name)
  }
  return (
    <input
      className={`${roadFieldClass} min-w-0 flex-1`}
      aria-label={label}
      maxLength={200}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        // The list moves between rows on these keys; in a name they move the caret.
        if (['Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.stopPropagation()
      }}
    />
  )
}

/**
 * Imported points, lines and areas kept as reference. A named point can start a road or take the
 * active road's start or end, which is how a landing becomes a route end.
 */
export function ReferencePanel({
  workspace: w,
  mode,
  onImport,
  onLocate,
  focusedId,
  onPegAt,
  onRoadEndAt,
}: {
  workspace: RoadWorkspace
  mode: DrawMode
  onImport: () => void
  onLocate?: (feature: ReferenceFeature) => void
  focusedId?: string | null
  onPegAt?: (at: Coordinate, name: string) => void
  onRoadEndAt?: (at: Coordinate, name: string, end: 'start' | 'end') => void
}) {
  const features = w.project.reference ?? []
  const count = (shape: ReferenceShape) => features.filter((f) => referenceShape(f) === shape).length
  const summary = features.length
    ? (['point', 'line', 'area'] as const)
        .filter((shape) => count(shape))
        .map((shape) => counted(count(shape), SHAPE_LABELS[shape].toLowerCase()))
        .join(' · ')
    : 'None'
  const pegging = mode === 'road' || mode === 'extend'
  const fixedRoad = !!w.alignment.mappedRoad
  const change = (next: ReferenceFeature[]) =>
    w.update((project) => ({ ...project, reference: next.length ? next : undefined }))
  return (
    <RoadSection
      title="Reference layers"
      summary={summary}
      help="Points, lines and areas brought in for reference, such as landings, a property boundary or an area of interest. The plan draws them and nothing else reads them: they are not priced, crossed or avoided. A named point can start a road or take the active road's start or end."
    >
      <div className="space-y-2" data-testid="road-reference-layers">
        <Button variant="outline" size="sm" className="w-full" onClick={onImport}>
          <Upload className="mr-2 size-3" />
          Import reference layer
        </Button>
        {features.length > 0 && (
          // An import can hold 500 features: only the rows in view are mounted, in a list of bounded height.
          <div className="max-h-80 overflow-y-auto overscroll-none rounded border" data-map-sidebar-scroll="true">
            <VirtualResultList
              items={features}
              getKey={(feature) => feature.id}
              estimateSize={72}
              label="Reference features"
              revealKey={focusedId}
            >
              {(feature) => {
                const shape = referenceShape(feature)
                const at = shape === 'point' ? ((feature.geometry as GeoJSON.Point).coordinates as Coordinate) : null
                return (
                  <div
                    className={`space-y-1.5 p-2 ${feature.id === focusedId ? 'bg-primary/5' : ''}`}
                    data-reference-row={feature.id}
                  >
                    <div className="flex items-center gap-1">
                      <ReferenceName
                        key={feature.name}
                        name={feature.name}
                        label={`Name of reference ${SHAPE_LABELS[shape].toLowerCase()} ${feature.name}`}
                        onRename={(name) => change(features.map((f) => (f.id === feature.id ? { ...f, name } : f)))}
                      />
                      {onLocate && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 shrink-0"
                          aria-label={`Show ${feature.name} on the plan`}
                          title="Show on plan"
                          onClick={() => onLocate(feature)}
                        >
                          <LocateFixed className="size-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0"
                        aria-label={`Remove reference ${feature.name}`}
                        title="Remove"
                        onClick={() => change(features.filter((f) => f.id !== feature.id))}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                    <p className="truncate text-2xs text-muted-foreground" title={feature.source}>
                      {SHAPE_LABELS[shape]}
                      {feature.source ? ` · ${feature.source}` : ''}
                    </p>
                    {at && (onPegAt || onRoadEndAt) && (
                      <div className="grid grid-cols-3 gap-1">
                        {onPegAt && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 min-w-0 px-1 text-xs"
                            title={
                              pegging
                                ? 'Add this point to the road being pegged'
                                : 'Start pegging a new road at this point'
                            }
                            aria-label={pegging ? `Peg ${feature.name}` : `Peg a road from ${feature.name}`}
                            onClick={() => onPegAt(at, feature.name)}
                          >
                            {pegging ? 'Peg here' : 'Peg from'}
                          </Button>
                        )}
                        {onRoadEndAt &&
                          (['start', 'end'] as const).map((end) => (
                            <Button
                              key={end}
                              size="sm"
                              variant="outline"
                              className="h-7 min-w-0 px-1 text-xs"
                              disabled={fixedRoad || pegging}
                              title={
                                fixedRoad
                                  ? 'A mapped road is held as recorded. Copy it as a design first.'
                                  : `Move the ${end} of ${w.alignment.name} onto this point`
                              }
                              aria-label={`Move the ${end} of the active road to ${feature.name}`}
                              onClick={() => onRoadEndAt(at, feature.name, end)}
                            >
                              Road {end}
                            </Button>
                          ))}
                      </div>
                    )}
                  </div>
                )
              }}
            </VirtualResultList>
          </div>
        )}
      </div>
    </RoadSection>
  )
}
