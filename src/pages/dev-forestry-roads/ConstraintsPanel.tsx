import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConstraintPolicyEditor } from './ConstraintPolicyEditor'
import { resolveConstraint } from './constraints'
import { RoadSection } from './SidebarParts'
import type { ContextFeature } from './types'
import type { RoadWorkspace } from './useRoadWorkspace'

/** Explicit planning treatments; cutblocks have their own history and access panel. */
export function ConstraintsPanel({
  workspace: w,
  onDraw,
  onLocate,
  focusedId,
}: {
  workspace: RoadWorkspace
  onDraw: () => void
  /** Click an area's name to show it on the plan. */
  onLocate?: (area: ContextFeature) => void
  focusedId?: string | null
}) {
  const areas = w.project.context.filter((f) => f.kind === 'avoid')
  const blocked = areas.filter((f) => f.kind === 'avoid' && resolveConstraint(f).blocked).length
  return (
    <RoadSection
      title="Constraints"
      summary={areas.length ? `${areas.length}${blocked ? ` · ${blocked} blocked` : ''}` : 'None'}
      help="Choose an explicit treatment for each area. Conditional areas remain blocked until a current planning review is recorded. Avoidance penalties steer search; additional costs are planning allowances. Neither cost nor review establishes legal permission."
    >
      <div className="space-y-2" data-testid="road-constraints">
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
          <div
            key={feature.id}
            className={`space-y-2 rounded border p-2 ${feature.id === focusedId ? 'border-primary bg-primary/5' : ''}`}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="min-w-0 flex-1 truncate rounded text-left text-xs font-medium hover:text-primary disabled:cursor-default disabled:hover:text-current"
                aria-pressed={feature.id === focusedId}
                title={onLocate ? `Show ${feature.name} on the plan` : feature.name}
                disabled={!onLocate}
                onClick={() => onLocate?.(feature)}
              >
                {feature.name}
              </button>
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
            <ConstraintPolicyEditor
              feature={feature}
              onChange={(constraint) =>
                w.update((x) => ({
                  ...x,
                  context: x.context.map((c) => (c.id === feature.id ? { ...c, constraint } : c)),
                }))
              }
            />
          </div>
        ))}
      </div>
    </RoadSection>
  )
}
