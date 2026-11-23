import { useEffect, useMemo, useState } from 'react'
import { PenLine, Shapes, Upload, Waves } from 'lucide-react'
import { blockAreaHa } from '@/lib/forestry/blockSheet/blockFacts'
import { Button } from '@/components/ui/button'
import { ConfirmRemoveButton } from '@/components/ui/confirm-remove'
import { FileButton } from '@/components/ui/file-button'
import { FORM_INPUT_CLASS } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { TextButton } from '@/components/ui/text-button'
import { ToolSection } from '@/components/ui/tool-section'
import { cn } from '@/lib/utils'
import { removeBlock, removeShape, renameBlock } from '../edits'
import { entryOf, type Block, type Plan } from '../plan'
import type { StepProps } from './types'

const ha = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })

/** Mapped riparian overlap of one shape, measured off the page's thread in BC Albers. */
function useRiparianOverlap(geometry: Block['shapes'][number]['geometry'] | undefined, zones: Plan['zones']) {
  const input = useMemo(() => ({ geometry, zones }), [geometry, zones])
  const [answer, setAnswer] = useState<{ input: typeof input; ha?: number | null; error?: string }>()
  useEffect(() => {
    if (!input.geometry || !input.zones) return
    const worker = new Worker(new URL('../riparian.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => setAnswer({ input, ...data })
    worker.onerror = (e) => setAnswer({ input, error: e.message })
    worker.postMessage(input)
    return () => worker.terminate()
  }, [input])
  if (!zones || !geometry) return null
  return answer?.input === input ? answer : { input, pending: true as const }
}

/** Step 2: the blocks, each with the shape as proposed and any reconfigured shapes. */
export function BlocksStep({
  plan,
  edit,
  selectedBlock,
  selectBlock,
  drawing,
  startDrawing,
  importFiles,
  shown,
}: StepProps) {
  const block = plan.blocks.find((b) => b.id === selectedBlock) ?? null
  const shownShape = block
    ? (block.shapes.find((s) => s.id === entryOf(plan, shown.schedule, block.id).shape) ?? block.shapes[0])
    : undefined
  const overlap = useRiparianOverlap(shownShape?.geometry, plan.zones)
  const busy = drawing !== null
  return (
    <>
      <ToolSection
        title="Blocks"
        help="A block is drawn once. Its timing belongs to each schedule (step 3), so the same block can be cut now in one schedule and later, or not at all, in another."
        summary={`${plan.blocks.length} block${plan.blocks.length === 1 ? '' : 's'}`}
        defaultOpen
        actions={
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={drawing === 'block' ? 'default' : 'outline'}
              disabled={busy && drawing !== 'block'}
              onClick={() => startDrawing('block')}
            >
              <PenLine className="size-3.5" />
              Draw
            </Button>
            <FileButton
              size="sm"
              variant="outline"
              label="Import blocks"
              accept=".geojson,.json,application/json"
              onFiles={(files) => importFiles('blocks', files)}
            >
              <Upload className="size-3.5" />
              Import
            </FileButton>
          </div>
        }
      >
        {plan.blocks.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Draw a block on the map, or import a GeoJSON file of polygons. A <code>year</code> on a feature sets when
            the schedule under review cuts it.
          </p>
        ) : (
          <ul className="space-y-1" aria-label="Blocks">
            {plan.blocks.map((b) => {
              const area = blockAreaHa(b.shapes[0].geometry)
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    aria-pressed={b.id === selectedBlock}
                    onClick={() => selectBlock(b.id === selectedBlock ? null : b.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent',
                      b.id === selectedBlock && 'border-primary bg-accent',
                    )}
                  >
                    <span className="truncate font-medium">{b.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {`${ha.format(area)} ha`}
                      {b.shapes.length > 1 ? ` · ${b.shapes.length} shapes` : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ToolSection>

      {block && (
        <ToolSection title={`Selected · ${block.name}`} defaultOpen summary={`${block.shapes.length} shape(s)`}>
          <label className="block text-xs font-medium">
            Name
            <input
              className={cn(FORM_INPUT_CLASS, 'mt-1')}
              defaultValue={block.name}
              key={block.id}
              onBlur={(e) => edit((p) => renameBlock(p, block.id, e.target.value))}
            />
          </label>
          <div className="space-y-1">
            <p className="text-xs font-medium">Shapes</p>
            <ul className="space-y-1">
              {block.shapes.map((shape, i) => {
                const area = blockAreaHa(shape.geometry)
                return (
                  <li key={shape.id} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {shape.name}
                      <span className="text-xs text-muted-foreground">
                        {` · ${ha.format(area)} ha gross`}
                        {shape.id === shownShape?.id ? ' · on the map' : ''}
                      </span>
                    </span>
                    {i > 0 && (
                      <ConfirmRemoveButton
                        label={`Remove ${shape.name}`}
                        question={`Remove the shape ${shape.name}?`}
                        detail="Schedules that cut this shape go back to the block as proposed."
                        onConfirm={() => edit((p) => removeShape(p, block.id, shape.id))}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
            <Button
              size="sm"
              variant={drawing === 'shape' ? 'default' : 'outline'}
              disabled={busy && drawing !== 'shape'}
              onClick={() => startDrawing('shape')}
            >
              <Shapes className="size-3.5" />
              Draw another shape
            </Button>
            <p className="text-2xs text-muted-foreground">
              A reconfigured shape lets a schedule cut a different footprint for the same block (step 3).
            </p>
          </div>
          <p className="text-xs">
            {overlap === null
              ? 'Riparian overlap: no zones loaded.'
              : 'pending' in overlap
                ? 'Measuring riparian overlap…'
                : overlap.error
                  ? `Riparian overlap could not be measured: ${overlap.error}`
                  : `Mapped riparian overlap: ${ha.format(overlap.ha ?? 0)} ha (the shape on the map).`}
          </p>
          <InlineAlert tone="info">
            Gross area is measured from the drawing. Net area to be reforested needs its own survey and exclusions.
          </InlineAlert>
          <ConfirmRemoveButton
            label="Remove block"
            question={`Remove ${block.name}?`}
            detail="Its timing in every schedule and its review go with it."
            onConfirm={() => {
              edit((p) => removeBlock(p, block.id))
              selectBlock(null)
            }}
          >
            Remove block
          </ConfirmRemoveButton>
        </ToolSection>
      )}

      <ToolSection
        title="Riparian zones"
        help="Mapped riparian zones, measured against each block in BC Albers. Stream class and buffer widths need their own evidence."
        summary={plan.zones ? plan.zones.source : 'None loaded'}
      >
        {plan.zones ? (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate">{plan.zones.source}</span>
            <TextButton onClick={() => edit((p) => ({ ...p, zones: undefined }))}>Remove</TextButton>
          </div>
        ) : (
          <FileButton
            size="sm"
            variant="outline"
            label="Load riparian zones"
            accept=".geojson,.json,application/json"
            onFiles={(files) => importFiles('zones', files)}
          >
            <Waves className="size-3.5" />
            Load zones
          </FileButton>
        )}
      </ToolSection>
    </>
  )
}
