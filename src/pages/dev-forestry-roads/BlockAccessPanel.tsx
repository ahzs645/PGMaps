import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { RoadSelect } from './Controls'
import type { BlockAccessResult } from './blockAccess'
import type { SidebarProps } from './DesignSidebarBody'
import type { TerrainSource } from './types'

/** A block access run, kept with what it was run on so the panel can tell when it has gone stale. */
export interface BlockAccessState {
  blockId: string
  /** The block geometry the run used, serialised, so a reshaped block marks the result stale. */
  geometry: string
  source: TerrainSource
  result: BlockAccessResult
  selected: number
}
/** Option colours, shared with the plan preview so a row and its line match. */
export const BLOCK_ACCESS_COLORS = ['#2563eb', '#db2777', '#16a34a', '#9333ea']
const length = (metres: number) =>
  metres < 1000 ? `${Math.round(metres).toLocaleString('en-CA')} m` : `${(metres / 1000).toFixed(2)} km`
const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}k`)
const grade = (percent: number) => `${percent.toFixed(1)}%`

/** Pick a harvest block and get a few proposed roads from its edge to the nearest FSRs. */
export function BlockAccessPanel({ full, ...p }: SidebarProps & { full: boolean }) {
  const { project, source } = p.workspace
  const blocks = project.context.filter((feature) => feature.kind === 'harvest' && feature.geometry.type === 'Polygon')
  const [chosen, setChosen] = useState('')
  const blockId = blocks.some((block) => block.id === chosen) ? chosen : (blocks[0]?.id ?? '')
  const block = blocks.find((candidate) => candidate.id === blockId)
  const run = p.blockAccess?.blockId === blockId ? p.blockAccess : null
  const stale = !!run && (run.source !== source || !block || run.geometry !== JSON.stringify(block.geometry))
  const busy = !!p.workspace.busy
  return (
    <div className="space-y-2 border-t pt-3" data-testid="road-block-access">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold">Access a harvest block</p>
        <InfoTip label="About block access">
          Finds the mapped FSR sections nearest the block, puts a landing on the block edge closest to each, and
          searches a terrain-cost road from every landing to its FSR. Loaded trucks travel from the landing out to the
          FSR, so the grades by haul direction above apply that way round. Options are ranked by search score, which is
          not a complete access cost; the junction, road condition and access rights still need review. Real terrain
          loads active BC FSRs near the block first.
        </InfoTip>
      </div>
      {blocks.length ? (
        <RoadSelect
          ariaLabel="Harvest block"
          value={blockId}
          onValueChange={setChosen}
          options={blocks.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
        />
      ) : (
        <p className="text-2xs text-muted-foreground">No harvest blocks yet. Draw one, or load mapped cutblocks.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" disabled={busy || !p.onDrawBlock} onClick={p.onDrawBlock}>
          Draw block
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !block || !p.onFindBlockAccess}
          onClick={() => block && p.onFindBlockAccess?.(block.id)}
        >
          Find access
        </Button>
      </div>
      {run && (
        <div className="space-y-2" data-testid="road-block-access-options">
          {stale && (
            <InlineAlert tone="warning">The block or terrain changed. Find access again to refresh these.</InlineAlert>
          )}
          <div role="radiogroup" aria-label="Access options" className="space-y-1">
            {run.result.options.map((option, i) => (
              <button
                key={`${option.target.featureId}-${i}`}
                type="button"
                role="radio"
                aria-checked={i === run.selected}
                data-access-option={i}
                onClick={() => p.onSelectBlockAccess?.(i)}
                className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${i === run.selected ? 'border-primary bg-primary/5' : 'hover:bg-muted'}`}
              >
                <span
                  className="mt-1 size-2 shrink-0 rounded-full"
                  style={{ background: BLOCK_ACCESS_COLORS[i % BLOCK_ACCESS_COLORS.length] }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {i + 1}. {option.target.name}
                  </span>
                  <span className="block tabular-nums text-muted-foreground">
                    {length(option.lengthM)} · {money(option.cost)} search cost
                  </span>
                  <span className="block tabular-nums text-muted-foreground">
                    Steepest loaded uphill {grade(option.steepestLoadedUphillPercent)} · empty uphill{' '}
                    {grade(option.steepestEmptyUphillPercent)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {run.result.attempts.some((attempt) => attempt.error) && (
            <details className="text-2xs text-muted-foreground">
              <summary className="cursor-pointer">
                {run.result.attempts.filter((attempt) => attempt.error).length} FSR section(s) had no passing route
              </summary>
              {run.result.attempts
                .filter((attempt) => attempt.error)
                .map((attempt) => (
                  <p key={attempt.target.featureId} className="mt-1">
                    {attempt.target.name}: {attempt.error}
                  </p>
                ))}
            </details>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" disabled={busy || stale || full} onClick={p.onAdoptBlockAccess}>
              Add as road
            </Button>
            <Button size="sm" variant="ghost" onClick={p.onClearBlockAccess}>
              Clear options
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
