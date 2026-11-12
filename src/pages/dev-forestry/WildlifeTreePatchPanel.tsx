import type { ReactNode } from 'react'
import { Trees, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ToolSection } from '@/components/ui/tool-section'
import { formatMeasure } from '@/lib/format'

import { MASK_LABELS, MAX_ASSESSMENT_MASKS } from './assessmentMasks'
import { MASK_COLORS } from './planMapStyle'
import type { AssessmentMask } from './types'
import { polygonAreaMeters } from './visibility'

/**
 * Step 3: draw a wildlife tree patch on the plan map in one click. It becomes a
 * `retained` assessment mask — kept green, out of the cleared ground and the
 * alteration — so the next run tests the crew's placement from the viewpoint.
 * The road view stays open while drawing, as for a tree-free area, so the
 * timber the patch keeps can be watched from the road.
 */
export function WildlifeTreePatchPanel({
  masks,
  drawing,
  onDraw,
  drawControls,
  onRemove,
  stale,
}: {
  masks: ReadonlyArray<AssessmentMask>
  /** A patch is being traced now. */
  drawing: boolean
  onDraw: (on: boolean) => void
  /** The tracing prompt with Finish and Cancel, shown while drawing. */
  drawControls: ReactNode
  onRemove: (id: string) => void
  /** The scene changed since the run: the patches are not in its figures yet. */
  stale: boolean
}) {
  const patches = masks.filter((mask) => mask.kind === 'retained')
  const full = masks.length >= MAX_ASSESSMENT_MASKS
  return (
    <ToolSection
      title="Wildlife tree patches"
      aria-label="Wildlife tree patches"
      help={`A wildlife tree patch or other retention left standing in or beside the block, as the crew would place it. It is saved as a "${MASK_LABELS.retained}" mask: kept green, left out of the cleared ground and the percent alteration, and drawn standing in the road view. Run the simulation again to test the placement from the viewpoint; a patch the run samples with fewer than eight cells makes the result provisional, so raise the sample budget in Simulation settings for a small one. Patches also go into the visual measures in step 5.`}
    >
      <div className="space-y-1.5 text-xs">
        <Button
          type="button"
          variant={drawing ? 'default' : 'outline'}
          size="sm"
          className="h-8 w-full text-xs touch:h-10"
          aria-pressed={drawing}
          disabled={!drawing && full}
          onClick={() => onDraw(!drawing)}
          title="Trace the patch on the plan map; the road view stays open"
        >
          <Trees className="h-3.5 w-3.5" />
          {drawing ? 'Drawing on the plan…' : 'Draw a wildlife tree patch'}
        </Button>
        {drawing && drawControls}
        {full && !drawing && (
          <p className="text-2xs text-muted-foreground">
            The scene holds {MAX_ASSESSMENT_MASKS} masks, the most it keeps: remove one to draw another.
          </p>
        )}
        {patches.length > 0 && (
          <ul
            className="divide-y divide-border overflow-hidden rounded-md border border-border text-2xs"
            aria-label="Wildlife tree patches in the scene"
          >
            {patches.map((patch) => (
              <li key={patch.id} className="flex items-center gap-2 py-0.5 pl-2 pr-0.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm border"
                  style={{ backgroundColor: MASK_COLORS.retained, borderColor: '#475569' }}
                />
                <span className="min-w-0 flex-1 truncate" title={patch.source || undefined}>
                  {patch.name}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatMeasure(polygonAreaMeters(patch.geometry) / 10_000, 'ha', { maximumFractionDigits: 2 })}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive touch:h-10 touch:w-10"
                  onClick={() => onRemove(patch.id)}
                  aria-label={`Remove ${patch.name}`}
                  title="Remove the patch"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {patches.length > 0 && stale && (
          <p className="text-2xs text-muted-foreground">Run the simulation again to see the patches in the figures.</p>
        )}
      </div>
    </ToolSection>
  )
}
