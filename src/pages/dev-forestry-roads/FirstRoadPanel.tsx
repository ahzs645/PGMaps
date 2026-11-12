import { useMemo, useState } from 'react'
import { Route } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CommandButton } from '@/components/interfaces/CommandButton'
import type { CommandState, WorkspaceCommand } from '@/components/interfaces/workspaceCommands'
import { loadableMappedRoads } from './mappedRoad'
import { roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import type { ContextFeature } from './types'

/**
 * A design with no road yet: peg one, sketch one, import one, or start from a mapped road in the
 * project. The first four are the registry's commands, with the workspace's own rules.
 */
export function FirstRoadPanel({
  context,
  commandStates,
  onCommand,
  onLoadMappedRoad,
}: {
  context: readonly ContextFeature[]
  commandStates?: Partial<Record<WorkspaceCommand, CommandState>>
  onCommand: (id: WorkspaceCommand) => void
  onLoadMappedRoad: (featureId: string) => void
}) {
  const tool = (id: WorkspaceCommand, caption: string, extra: { primary?: boolean; wide?: boolean } = {}) => (
    <div className={extra.wide ? 'col-span-2 grid' : 'grid'}>
      <CommandButton
        id={id}
        surface="sidebar"
        state={commandStates?.[id]}
        presentation={{ caption, emphasis: extra.primary ? 'primary' : undefined }}
        onRun={onCommand}
      />
    </div>
  )
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
          This design has no road yet. Peg one point by point, sketch one freehand, import a line, or load a mapped road
          to read its profile on this terrain.
        </p>
        <div className="grid grid-cols-2 gap-1">
          {tool('peg', 'Peg road', { primary: true })}
          {tool('sketch', 'Sketch road')}
          {tool('importAlignment', 'Import line', { wide: true })}
        </div>
        {roads.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold">Mapped roads in this project · {roads.length}</p>
            <div className="grid">
              <CommandButton
                id="loadMapped"
                surface="sidebar"
                state={commandStates?.loadMapped}
                presentation={{ caption: 'Load all roads in view' }}
                onRun={onCommand}
              />
            </div>
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
            <ul className="max-h-64 space-y-1 overflow-y-auto overscroll-none" aria-label="Mapped roads to load">
              {shown.map(({ feature, lengthM, parts }) => (
                <li key={feature.id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1">
                  <div className="min-w-0 text-xs">
                    <div className="truncate font-medium">{feature.name}</div>
                    <div className="text-muted-foreground tabular-nums">
                      {lengthM >= 1000 ? `${(lengthM / 1000).toFixed(2)} km` : `${Math.round(lengthM)} m`}
                      {parts > 1 ? ` · ${parts} parts` : ''}
                    </div>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    className="shrink-0 gap-1"
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
