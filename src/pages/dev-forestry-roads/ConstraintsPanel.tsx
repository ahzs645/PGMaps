import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { OptionalNumberField } from './Controls'
import { RoadSection } from './SidebarParts'
import type { RoadWorkspace } from './useRoadWorkspace'

/** Areas the road should keep out of, or pay to cross. Harvest blocks sit here as map context. */
export function ConstraintsPanel({ workspace: w, onDraw }: { workspace: RoadWorkspace; onDraw: () => void }) {
  const areas = w.project.context.filter((f) => f.kind === 'avoid' || f.kind === 'harvest')
  const excluded = areas.filter((f) => f.kind === 'avoid' && f.routeCostPerM === undefined).length
  return (
    <RoadSection
      title="Constraints"
      summary={areas.length ? `${areas.length}${excluded ? ` · ${excluded} excluded` : ''}` : 'None'}
      help="An area with no cost is excluded: route search cannot enter it. Enter a cost per metre and the search may cross it at that extra cost. The cost does not make crossing it permissible."
    >
      <div className="space-y-1" data-testid="road-constraints">
        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs"
          aria-label="Draw avoidance area"
          onClick={onDraw}
        >
          Draw constraint
        </Button>
        {areas.map((feature) => (
          <div key={feature.id} className="flex items-center gap-1 rounded border px-2 py-1">
            <span className="min-w-0 flex-1 text-xs">
              <span className="block truncate">{feature.name}</span>
              <span className="block text-2xs leading-4 text-muted-foreground">
                {feature.kind === 'harvest'
                  ? 'Harvest area'
                  : feature.routeCostPerM === undefined
                    ? 'Excluded from route search'
                    : `Additional cost, $${feature.routeCostPerM}/m`}
              </span>
            </span>
            {feature.kind === 'avoid' && feature.geometry.type === 'Polygon' && (
              <div
                className="w-20"
                title="Empty excludes the area; a value lets route search cross it at this cost per metre."
              >
                <OptionalNumberField
                  label={`${feature.name} zone cost per metre`}
                  hideLabel
                  placeholder="excluded"
                  value={feature.routeCostPerM ?? null}
                  min={0}
                  max={1e6}
                  step={10}
                  onChange={(cost) =>
                    w.update((x) => ({
                      ...x,
                      context: x.context.map((c) => {
                        if (c.id !== feature.id) return c
                        const { routeCostPerM: _old, ...rest } = c
                        void _old
                        return cost === null ? rest : { ...rest, routeCostPerM: cost }
                      }),
                    }))
                  }
                />
              </div>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              aria-label={`Remove context ${feature.name}`}
              onClick={() => w.update((x) => ({ ...x, context: x.context.filter((c) => c.id !== feature.id) }))}
            >
              <Trash2 className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </RoadSection>
  )
}
