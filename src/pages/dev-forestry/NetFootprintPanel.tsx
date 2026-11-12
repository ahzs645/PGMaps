import { useState } from 'react'
import { Loader2, Trees } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import { ToolSection } from '@/components/ui/tool-section'
import { formatMeasure } from '@/lib/format'

import { MASK_LABELS, MAX_ASSESSMENT_MASKS } from './assessmentMasks'
import {
  blockFootprint,
  fetchBlockFootprints,
  reserveMaskFields,
  type BlockFootprint,
  type GroupReserve,
} from './resultsReserves'
import type { AssessmentMask, TargetPolygon } from './types'

type Lookup =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; footprints: Array<{ block: TargetPolygon; footprint: BlockFootprint }> }

const ha = (value: number | null) =>
  value === null ? 'not on FTEN' : formatMeasure(value, 'ha', { maximumFractionDigits: 1 })

/**
 * Step 3: each block's footprint three ways — the FTEN gross outline, FTEN's planned net area, and
 * gross minus the RESULTS group reserves inside it — and one click to leave those reserves standing
 * as `retained` masks, which is how the VIA sheets' net blocks are drawn. Dispersed retention is
 * never subtracted. A failed read is an error with a retry, never "no reserves".
 */
export function NetFootprintPanel({
  blocks,
  masks,
  onAdd,
  stale,
}: {
  blocks: readonly TargetPolygon[]
  masks: ReadonlyArray<AssessmentMask>
  onAdd: (reserves: GroupReserve[]) => void
  stale: boolean
}) {
  const [lookup, setLookup] = useState<Lookup>({ status: 'idle' })
  const added = new Set(masks.map((mask) => mask.source))
  const find = async () => {
    if (!blocks.length) return
    setLookup({ status: 'loading' })
    try {
      const { reserves, ftenBlocks } = await fetchBlockFootprints(
        blocks.map((block) => block.geometry),
        fetch,
      )
      setLookup({
        status: 'ready',
        footprints: blocks.map((block) => ({ block, footprint: blockFootprint(block.geometry, reserves, ftenBlocks) })),
      })
    } catch (error) {
      setLookup({ status: 'error', message: error instanceof Error ? error.message : 'DataBC did not answer.' })
    }
  }
  const pending =
    lookup.status === 'ready'
      ? lookup.footprints.flatMap(({ footprint }) =>
          footprint.reserves.filter((reserve) => !added.has(reserveMaskFields(reserve).source)),
        )
      : []
  return (
    <ToolSection
      title="Net block footprints"
      aria-label="Net block footprints"
      summary="FTEN gross, planned net, net of reserves"
      toggleProps={{ 'data-forestry-disclosure': 'net-footprints' }}
      help={`An FTEN block is gross: it includes the reserves left standing inside it. The VIA sheets draw the net block, FTEN minus its RESULTS group reserves, which in the November 2026 study reproduced a VIA's printed net areas to 0.1 ha. Reserves you leave standing become "${MASK_LABELS.retained}" masks: kept green, uncleared and never altered. Dispersed retention covers the whole block and is not subtracted. Proposals with no RESULTS opening yet stay gross; draw a wildlife tree patch for a planned reserve.`}
    >
      <div className="space-y-1.5 text-xs">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!blocks.length || lookup.status === 'loading'}
          onClick={() => void find()}
        >
          {lookup.status === 'loading' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trees className="h-3.5 w-3.5" />
          )}
          {lookup.status === 'loading' ? 'Reading RESULTS and FTEN…' : 'Read the blocks’ reserves'}
        </Button>
        {lookup.status === 'error' && (
          <InlineAlert tone="error">
            {lookup.message}{' '}
            <button type="button" className="underline" onClick={() => void find()}>
              Retry
            </button>
          </InlineAlert>
        )}
        {lookup.status === 'ready' &&
          lookup.footprints.map(({ block, footprint }) => (
            <div key={block.id} aria-label={`Footprint of ${block.name}`}>
              <p className="font-medium">{block.name}</p>
              <KeyValueRows
                variant="divided"
                rows={[
                  { label: 'FTEN gross (the outline)', value: ha(footprint.grossHectares) },
                  {
                    label: `FTEN planned net${footprint.ftenCutBlockId ? ` · block ${footprint.ftenCutBlockId}` : ''}`,
                    value: ha(footprint.plannedNetHectares),
                  },
                  {
                    label: `Net of ${footprint.reserves.length} group reserve${footprint.reserves.length === 1 ? '' : 's'}`,
                    value: ha(footprint.netOfReservesHectares),
                  },
                ]}
              />
            </div>
          ))}
        {lookup.status === 'ready' && pending.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={masks.length + pending.length > MAX_ASSESSMENT_MASKS}
            onClick={() => onAdd(pending)}
          >
            Leave {pending.length} group reserve{pending.length === 1 ? '' : 's'} standing
          </Button>
        )}
        {lookup.status === 'ready' && !pending.length && (
          <p className="text-2xs text-muted-foreground">
            {lookup.footprints.some(({ footprint }) => footprint.reserves.length)
              ? 'The group reserves are standing in the scene.'
              : 'RESULTS records no group reserves in these blocks: their outlines stay gross.'}
          </p>
        )}
        {stale && masks.some((mask) => mask.source.startsWith('RESULTS forest cover reserve')) && (
          <p className="text-2xs text-muted-foreground">
            Run the simulation again to see the net blocks in the figures.
          </p>
        )}
      </div>
    </ToolSection>
  )
}
