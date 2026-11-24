import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { CalculationTable } from '@/components/ui/calculation-results'
import { InlineAlert } from '@/components/ui/map-panels'
import type { Pack } from '../../../../packages/legal-rules/src/contract'
import { saveRangeReview } from '../edits'
import { entryOf, shapeOf, type Block, type MappedEvidence, type MappedLayerId, type Plan } from '../plan'
import { shapeSignature } from '../records'
import type { StepProps } from '../steps/types'
import {
  formatHa,
  GROUP_LABELS,
  layerSummary,
  MAPPED_LAYER_INFO,
  mappedCurrent,
  readMappedEvidence,
} from './grazingEvidence'
import { RANGE_INSTRUMENT, rangeReviewFor } from './rangeReview'

type State =
  | { status: 'idle' }
  | { status: 'reading'; layer: MappedLayerId | null }
  | { status: 'failed'; error: string }

const today = () => new Date().toISOString().slice(0, 10)

/**
 * Mapped evidence for the grazing review: on the reviewer's click, the ADA/SRA, range tenure and
 * Tantalis grazing layers read against the block shape the review is for, kept on the review
 * (`RangeReview.mapped`) with the footprint it was read for. Candidates to weigh beside the facts;
 * it answers none of them and never reaches the rule evaluation.
 */
export function GrazingEvidence({
  plan,
  edit,
  block,
  schedule,
  library,
}: {
  plan: Plan
  edit: StepProps['edit']
  block: Block
  schedule: string
  library: Pack[]
}) {
  const [state, setState] = useState<State>({ status: 'idle' })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const { record } = rangeReviewFor(plan, block, schedule)
  const saved = plan.rangeReviews?.find((r) => r.block === block.id && r.schedule === schedule)
  const mapped: MappedEvidence | undefined = record.mapped ?? saved?.mapped
  const current = Boolean(record.mapped && mappedCurrent(record))
  const facts = library.find((p) => p.id === RANGE_INSTRUMENT)?.facts ?? []
  const factLabel = (id: string) => facts.find((f) => f.id === id)?.label

  async function read() {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    const shape = shapeOf(block, entryOf(plan, schedule, block.id))
    const signature = shapeSignature(shape.geometry)
    setState({ status: 'reading', layer: null })
    try {
      const { overlapsWith } = await import('../oldForest/oldForest')
      const evidence = await readMappedEvidence({
        footprint: shape.geometry,
        shape: shape.id,
        signature,
        fetch: (url, init) => fetch(url, init),
        signal: controller.signal,
        measure: overlapsWith,
        readOn: today(),
        onProgress: (layer) => setState({ status: 'reading', layer }),
      })
      if (controller.signal.aborted) return
      edit((p) => {
        const next = rangeReviewFor(p, block, schedule).record
        // The block was redrawn during the read: what came back describes other ground.
        if (next.shape !== evidence.shape || next.footprint !== evidence.footprint) return p
        return saveRangeReview(p, { ...next, mapped: evidence })
      })
      setState({ status: 'idle' })
    } catch (e) {
      if (controller.signal.aborted) return setState({ status: 'idle' })
      setState({ status: 'failed', error: e instanceof Error ? e.message : 'The read failed.' })
    } finally {
      if (abort.current === controller) abort.current = null
    }
  }

  return (
    <div className="space-y-2" data-testid="block-planning-grazing-evidence">
      <p className="text-xs font-medium">Mapped evidence</p>
      <p className="text-2xs text-muted-foreground">
        Reads DataBC’s agriculture development and settlement reserve areas, range tenures and Tantalis grazing tenures
        against this block shape. What overlaps is a candidate to weigh when answering the facts below; it answers none
        of them. The orders’ maps are a visual representation, not for legal purposes.
      </p>
      {state.status === 'reading' ? (
        <div className="flex items-center gap-2">
          <InlineAlert loading>
            {state.layer ? `Reading ${MAPPED_LAYER_INFO[state.layer].title.toLowerCase()}…` : 'Starting the read…'}
          </InlineAlert>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              abort.current?.abort()
              abort.current = null
              setState({ status: 'idle' })
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => void read()}>
          {mapped ? 'Read them again' : 'Read mapped tenures and areas'}
        </Button>
      )}
      {state.status === 'failed' && <InlineAlert tone="error">{state.error}</InlineAlert>}
      {mapped && !current && (
        <InlineAlert tone="warning">
          The block shape changed since this read ({mapped.readOn}). Read it again before relying on it.
        </InlineAlert>
      )}
      {mapped &&
        mapped.layers.map((layer) => {
          const info = MAPPED_LAYER_INFO[layer.layer]
          const label = factLabel(info.fact)
          const also = info.alsoFact ? (factLabel(info.alsoFact) ?? `the fact ${info.alsoFact}`) : null
          return (
            <div key={layer.layer} className="space-y-1" data-testid={`grazing-evidence-${layer.layer}`}>
              {layer.features.length ? (
                <CalculationTable
                  caption={`${info.title} · read ${mapped.readOn} · ${formatHa(mapped.footprintHa)} ha footprint`}
                  rows={layer.features}
                  rowKey={(f) => `${f.group}:${f.id}:${f.name}`}
                  columns={[
                    { label: 'Feature', render: (f) => f.id },
                    { label: 'As DataBC names it', render: (f) => `${f.name} (${GROUP_LABELS[f.group]})` },
                    { label: 'Overlap', render: (f) => `${formatHa(f.overlapHa)} ha · ${f.sharePercent.toFixed(1)}%` },
                    { label: 'Details', render: (f) => f.details.join(' · ') },
                  ]}
                />
              ) : (
                <p className="text-xs">
                  <span className="font-medium">{info.title}:</span> {layerSummary(layer)}
                </p>
              )}
              {layer.status === 'truncated' && <InlineAlert tone="warning">{layerSummary(layer)}</InlineAlert>}
              {layer.features.length > 0 && layer.status !== 'truncated' && (
                <p className="text-2xs text-muted-foreground">{layerSummary(layer)}</p>
              )}
              <p className="text-2xs text-muted-foreground">
                Informs {label ? `“${label}”` : `the fact ${info.fact}`}
                {also ? ` and “${also}”` : ''}. {info.informs}
              </p>
            </div>
          )
        })}
    </div>
  )
}
