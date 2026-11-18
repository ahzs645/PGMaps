import { Crosshair, ListPlus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { FORM_INPUT_CLASS, SelectField, StyledSelect } from '@/components/ui/form-field'
import { insetBox } from '@/components/ui/inset-box'
import { formatMeasure } from '@/lib/format'
import { cn } from '@/lib/utils'

import { MAX_VIEWS_OF_INTEREST, type ViewOfInterest } from './viewsOfInterest'

const coordinate = (value: number) => formatMeasure(value, null, { minimumFractionDigits: 4, maximumFractionDigits: 4 })

/**
 * Step 1's *Assess from: A view*. A view of interest is the one way to put a viewpoint on the map: this picks which
 * one the assessment runs from (standing there with the road view closed) or places a new one on the plan, which is
 * then assessed from. The views' facing, lens and capture are step 2's. A spot placed before views existed is shown
 * with a way to keep it as a view.
 */
export function AssessFromView({
  views,
  blocks,
  currentViewId,
  standingName,
  legacySpot,
  disabled,
  adding,
  addBlockId,
  onAddBlockChange,
  onAdd,
  onCancelAdd,
  onChoose,
  onKeepSpot,
}: {
  views: readonly ViewOfInterest[]
  blocks: ReadonlyArray<{ id: string; name: string }>
  /** The planned view the assessment stands at now, if any (`currentPlannedView`). */
  currentViewId: string | null
  /** Where the assessment stands when that is not a planned view (an inventory row's *Stand here*). */
  standingName: string | null
  /** A spot placed directly, before views of interest: kept until made a view or replaced. */
  legacySpot: { lng: number; lat: number } | null
  /** While a capture runs, the station is the capture's. */
  disabled: boolean
  adding: boolean
  addBlockId: string | null
  onAddBlockChange: (blockId: string) => void
  onAdd: () => void
  onCancelAdd: () => void
  onChoose: (viewId: string) => void
  onKeepSpot: () => void
}) {
  const full = views.length >= MAX_VIEWS_OF_INTEREST
  return (
    <div className="space-y-2" data-assess-from="view">
      {views.length > 0 ? (
        <SelectField
          label="Assessed from"
          labelClassName="text-2xs text-muted-foreground"
          className={cn(FORM_INPUT_CLASS, 'py-1 text-xs')}
          value={currentViewId ?? ''}
          placeholder={standingName ? `${standingName} (not in the views)` : 'Choose a view of interest'}
          disabled={disabled}
          onValueChange={(viewId) => viewId && viewId !== currentViewId && onChoose(viewId)}
        >
          {views.map((view, index) => (
            <option key={view.id} value={view.id}>
              {index + 1}. {view.name}
            </option>
          ))}
        </SelectField>
      ) : (
        <p className="text-2xs text-muted-foreground">
          No views of interest yet. Add one on the map, or from the inventory&apos;s viewpoints and rec sites in step 2.
        </p>
      )}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant={adding ? 'default' : 'outline'}
          size="xs"
          className="shrink-0"
          aria-pressed={adding}
          disabled={(!adding && (full || !addBlockId)) || disabled}
          title={
            full
              ? `${MAX_VIEWS_OF_INTEREST} views is the most`
              : 'Click the plan where the view stands; the assessment then runs from it'
          }
          onClick={() => (adding ? onCancelAdd() : onAdd())}
        >
          <Crosshair className="h-3.5 w-3.5" />
          {adding ? 'Placing…' : 'Add a view on the map'}
        </Button>
        {blocks.length > 1 && (
          <StyledSelect
            aria-label="Block the new view faces"
            className={cn(FORM_INPUT_CLASS, 'min-w-0 flex-1 py-1 text-xs')}
            value={addBlockId ?? ''}
            onValueChange={onAddBlockChange}
            disabled={adding}
          >
            {blocks.map((block) => (
              <option key={block.id} value={block.id}>
                Facing {block.name}
              </option>
            ))}
          </StyledSelect>
        )}
      </div>
      {legacySpot && (
        <div
          className={cn(
            insetBox({ padding: 'none', tone: 'muted' }),
            'flex items-center gap-1.5 py-1 pl-2.5 pr-1 text-xs',
          )}
        >
          <span
            className="min-w-0 flex-1 truncate text-muted-foreground"
            title="A spot placed before views of interest"
          >
            Spot {coordinate(legacySpot.lat)}, {coordinate(legacySpot.lng)}
          </span>
          <Button type="button" variant="ghost" size="xs" className="shrink-0 text-2xs" onClick={onKeepSpot}>
            <ListPlus className="h-3.5 w-3.5" />
            Make it a view
          </Button>
        </div>
      )}
      <p className="text-3xs leading-4 text-muted-foreground">
        Choosing a view runs the assessment from it with the road view closed. Its facing, lens and capture are in step
        2.
      </p>
    </div>
  )
}
