import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { OptionalNumberField, roadFieldClass } from './Controls'
import { RoadSection } from './SidebarParts'
import { DEFAULT_ROUTE_OPTIONS, parseRouteSearchOptions } from './routing'
import type { RoadWorkspace } from './useRoadWorkspace'

export function CrossingCostControls({ workspace }: { workspace: RoadWorkspace }) {
  const streams = workspace.project.context.filter((f) => f.kind === 'stream')
  const options = workspace.project.routeSearch ?? DEFAULT_ROUTE_OPTIONS
  const [group, setGroup] = useState('')
  const [price, setPrice] = useState<number | null>(null)
  const change = (id: string, patch: { crossingCost?: number; crossingGroup?: string }) =>
    workspace.update((p) => ({ ...p, context: p.context.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  return (
    <RoadSection
      title="Crossing cost classes"
      help="The stream's own price overrides its named class, then the route search's default. These are route-search costs; installed structure quantities are priced separately."
    >
      <div className="space-y-2">
        {streams.map((f) => (
          <div key={f.id} className="rounded border p-2">
            <p className="break-words text-xs font-medium">{f.name}</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs">
                Class
                <input
                  aria-label={`${f.name} crossing class`}
                  className={roadFieldClass}
                  maxLength={100}
                  value={f.crossingGroup ?? ''}
                  onChange={(e) => change(f.id, { crossingGroup: e.target.value || undefined })}
                />
              </label>
              <OptionalNumberField
                label={`${f.name} crossing cost ($)`}
                value={f.crossingCost ?? null}
                min={0}
                max={1e9}
                onChange={(v) => change(f.id, { crossingCost: v ?? undefined })}
              />
            </div>
          </div>
        ))}
        {!streams.length && (
          <p className="text-xs text-muted-foreground">Import stream context to assign feature prices.</p>
        )}
        {Object.entries(options.crossingGroups ?? {}).map(([name, value]) => (
          <div key={name} className="flex items-center justify-between gap-2 text-xs">
            <span className="break-all">
              {name}: ${value.toLocaleString('en-CA')}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                const groups = { ...options.crossingGroups }
                delete groups[name]
                workspace.update((p) => ({
                  ...p,
                  routeSearch: parseRouteSearchOptions({ ...options, crossingGroups: groups }),
                }))
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs">
            New class
            <input
              aria-label="New crossing class"
              className={roadFieldClass}
              maxLength={100}
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            />
          </label>
          <OptionalNumberField label="Class crossing cost ($)" min={0} max={1e9} value={price} onChange={setPrice} />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!group.trim() || price === null}
          onClick={() => {
            workspace.update((p) => ({
              ...p,
              routeSearch: parseRouteSearchOptions({
                ...options,
                crossingGroups: { ...options.crossingGroups, [group.trim()]: price! },
              }),
            }))
            setGroup('')
            setPrice(null)
          }}
        >
          Save crossing class
        </Button>
      </div>
    </RoadSection>
  )
}
