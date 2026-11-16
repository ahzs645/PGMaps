/**
 * How tall a screen of standing timber, between the eye and a block, would have to be to hide the block's ground
 * (`screenHeight.ts`): a design aid for leave strips and screening retention. Presentational: the page runs the
 * reading and hands it in. Nothing here reaches the run or a reported VIA figure.
 */

import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/form-field'
import { InlineAlert } from '@/components/ui/map-panels'
import { StatGroup, type StatItem } from '@/components/ui/stat-group'
import { ToolSection } from '@/components/ui/tool-section'
import { DEFAULT_LOCALE } from '@/lib/format'

import { SCREEN_HEIGHT_MAX_METERS, hiddenShareAt, type ScreenHeightReading } from './screenHeight'

export type ScreenHeightPanelProps = {
  blocks: Array<{ id: string; name: string }>
  blockId: string | null
  onBlockChange: (id: string) => void
  /** Where the eye stands, worded ("Assessment viewpoint", "Road view at 1.24 km"), or null when there is no station. */
  stationLabel: string | null
  /** Null until run. */
  reading: ScreenHeightReading | null
  /** Progress 0–1 while running. */
  running: { progress: number } | null
  error: string | null
  /** Why it cannot run now (e.g. "Open the road view so its terrain loads"), or null. */
  unavailable: string | null
  onRun: () => void
  onCancel: () => void
  /** A typical drawn stand height to read the curve at (e.g. the block's VRI/drawn height). */
  standHeightMeters: number | null
}

const whole = new Intl.NumberFormat(DEFAULT_LOCALE, { maximumFractionDigits: 0 })
const oneDecimal = new Intl.NumberFormat(DEFAULT_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const percent = (value: number) => `${whole.format(value)}%`

/** A screen height as printed: rounded up, so a screen that tall does hide the share. */
export function formatScreenHeight(meters: number | null, hasVisibleGround: boolean): string {
  if (meters === null) return hasVisibleGround ? 'No screen outside the block can' : 'No visible ground'
  if (meters > SCREEN_HEIGHT_MAX_METERS) return `Taller than ${whole.format(SCREEN_HEIGHT_MAX_METERS)} m`
  if (meters < 10) return `${oneDecimal.format(Math.ceil(meters * 10) / 10)} m`
  return `${whole.format(Math.ceil(meters))} m`
}

export function ScreenHeightPanel({
  blocks,
  blockId,
  onBlockChange,
  stationLabel,
  reading,
  running,
  error,
  unavailable,
  onRun,
  onCancel,
  standHeightMeters,
}: ScreenHeightPanelProps) {
  const canRun = !running && !unavailable && blockId !== null && stationLabel !== null
  const blockName = blocks.find((block) => block.id === blockId)?.name ?? null
  return (
    <ToolSection
      title="Screen height"
      aria-label="Screen height needed to hide a block"
      className="text-xs"
      help={
        <>
          How tall standing timber between the eye and the block would have to be to hide the block&apos;s ground,
          sample by sample: a design aid for leave strips and screening retention. The screen may stand only on ground
          outside the block, past the road clearing round the eye. The run&apos;s own figures already include the timber
          the inventory records, so this is never added to them, and it is never a VIA figure.
        </>
      }
    >
      <SelectField
        label="Block"
        value={blockId ?? ''}
        placeholder={blocks.length ? 'Choose a block' : 'No blocks drawn'}
        disabled={!blocks.length || running !== null}
        onValueChange={onBlockChange}
      >
        {blocks.map((block) => (
          <option key={block.id} value={block.id}>
            {block.name}
          </option>
        ))}
      </SelectField>
      <p className="text-muted-foreground" data-screen-height-station>
        {stationLabel ? `Seen from: ${stationLabel}` : 'No station: place a viewpoint or open the road view.'}
      </p>
      {unavailable && <InlineAlert tone="warning">{unavailable}</InlineAlert>}
      {error && <InlineAlert tone="error">{error}</InlineAlert>}
      {running ? (
        <div className="space-y-2">
          <InlineAlert loading>
            Reading sightlines{blockName ? ` to ${blockName}` : ''}… {percent(running.progress * 100)}
          </InlineAlert>
          <Button size="xs" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="xs" variant="outline" disabled={!canRun} onClick={onRun}>
          {reading ? 'Run again' : 'Run'}
        </Button>
      )}
      {reading && <ScreenHeightResult reading={reading} standHeightMeters={standHeightMeters} />}
    </ToolSection>
  )
}

function ScreenHeightResult({
  reading,
  standHeightMeters,
}: {
  reading: ScreenHeightReading
  standHeightMeters: number | null
}) {
  const { counts } = reading
  const hasVisible = counts.visible > 0
  const atStand =
    standHeightMeters !== null && Number.isFinite(standHeightMeters) ? hiddenShareAt(reading, standHeightMeters) : null
  const items: StatItem[] = [
    {
      label: 'Hidden by terrain',
      value: reading.terrainHiddenPercent === null ? '—' : percent(reading.terrainHiddenPercent),
      note: 'of the known ground',
    },
    {
      label: 'Screen for half the visible ground',
      value: formatScreenHeight(reading.screenFor.half, hasVisible),
      compact: true,
    },
    {
      label: 'Screen for three quarters',
      value: formatScreenHeight(reading.screenFor.threeQuarters, hasVisible),
      compact: true,
    },
    { label: 'Screen for 90%', value: formatScreenHeight(reading.screenFor.ninety, hasVisible), compact: true },
  ]
  if (standHeightMeters !== null && Number.isFinite(standHeightMeters))
    items.push({
      key: 'stand',
      label: `At the stand's height (${whole.format(standHeightMeters)} m)`,
      value: atStand === null ? '—' : `${percent(atStand)} hidden`,
      note: 'of the visible ground',
      compact: true,
    })
  items.push({
    label: 'Unknown',
    value: whole.format(counts.unknown),
    note: counts.unknown ? `samples · ${percent(reading.unknownPercent)} of the block` : 'samples',
    tone: counts.unknown ? 'warning' : 'default',
  })
  return (
    <div className="space-y-2" data-screen-height-result>
      <StatGroup variant="tiles" size="sm" columns={2} items={items} aria-label="Screen height figures" />
      {hasVisible ? (
        <ScreenCurveChart reading={reading} standHeightMeters={standHeightMeters} />
      ) : (
        <p className="text-muted-foreground">The terrain leaves no ground in this block to screen.</p>
      )}
      <p className="text-2xs text-muted-foreground">
        {whole.format(counts.total)} samples {whole.format(reading.sampleSpacingMeters)} m apart
        {counts.unscreenable
          ? ` · ${whole.format(counts.unscreenable)} visible with no ground outside the block for a screen`
          : ''}{' '}
        · screens stand {reading.screenZone === 'outside-block' ? 'outside the block' : 'anywhere on the line'}, past{' '}
        {whole.format(reading.nearEyeExclusionMeters)} m from the eye. Unknown samples are neither hidden nor visible.
      </p>
    </div>
  )
}

// The plot frame in viewBox units; the SVG scales to its container.
const WIDTH = 320
const HEIGHT = 168
const MARGIN = { top: 14, right: 10, bottom: 30, left: 34 }
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom
const AXIS_FONT = 10
const X_TICKS = [0, 10, 20, 30, 40, 50, 60]
const Y_TICKS = [0, 25, 50, 75, 100]

const xAt = (meters: number) =>
  MARGIN.left + (Math.min(meters, SCREEN_HEIGHT_MAX_METERS) / SCREEN_HEIGHT_MAX_METERS) * PLOT_W
const yAt = (share: number) => MARGIN.top + PLOT_H - (share / 100) * PLOT_H

/**
 * Share of the visible ground hidden against screen height: one series, so no legend; the title names it. A
 * crosshair follows the pointer (or the arrow keys) to the nearest metre, and the numbers sit in a hidden table.
 */
export function ScreenCurveChart({
  reading,
  standHeightMeters,
}: {
  reading: ScreenHeightReading
  standHeightMeters: number | null
}) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const points = reading.curve.filter((point) => point.hiddenOfVisiblePercent !== null)
  const path = points
    .map((point, i) => `${i ? 'L' : 'M'}${xAt(point.heightMeters)},${yAt(point.hiddenOfVisiblePercent!)}`)
    .join('')
  const stand =
    standHeightMeters !== null && Number.isFinite(standHeightMeters) && standHeightMeters >= 0
      ? Math.min(standHeightMeters, SCREEN_HEIGHT_MAX_METERS)
      : null
  const standShare = stand === null ? null : hiddenShareAt(reading, stand)
  const hovered = hover === null ? null : (points.find((point) => point.heightMeters === hover) ?? null)

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    if (!(box.width > 0)) return
    const x = ((event.clientX - box.left) / box.width) * WIDTH
    const meters = Math.round(((x - MARGIN.left) / PLOT_W) * SCREEN_HEIGHT_MAX_METERS)
    setHover(Math.max(0, Math.min(SCREEN_HEIGHT_MAX_METERS, meters)))
  }
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    setHover((current) => Math.max(0, Math.min(SCREEN_HEIGHT_MAX_METERS, (current ?? stand ?? 0) + step)))
  }

  return (
    <figure className="min-w-0 space-y-1">
      <figcaption id={`${id}-title`} className="text-xs font-semibold text-foreground">
        Visible ground hidden by a screen of each height
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-auto w-full touch-none outline-none focus-visible:ring-1 focus-visible:ring-ring"
          role="img"
          aria-labelledby={`${id}-title`}
          tabIndex={0}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={onKeyDown}
          data-screen-height-chart
        >
          <g className="text-muted-foreground" fill="currentColor" fontSize={AXIS_FONT}>
            {Y_TICKS.map((share) => (
              <g key={share}>
                <line
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={yAt(share)}
                  y2={yAt(share)}
                  stroke="currentColor"
                  strokeOpacity={share === 0 ? 0.5 : 0.15}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text x={MARGIN.left - 4} y={yAt(share)} dy="0.32em" textAnchor="end">
                  {share}%
                </text>
              </g>
            ))}
            {X_TICKS.map((meters) => (
              <text key={meters} x={xAt(meters)} y={MARGIN.top + PLOT_H + 12} textAnchor="middle">
                {meters}
              </text>
            ))}
            <text x={MARGIN.left + PLOT_W / 2} y={HEIGHT - 2} textAnchor="middle">
              Screen height, m
            </text>
          </g>
          {stand !== null && (
            <g className="text-foreground" data-screen-height-stand>
              <line
                x1={xAt(stand)}
                x2={xAt(stand)}
                y1={MARGIN.top}
                y2={MARGIN.top + PLOT_H}
                stroke="currentColor"
                strokeOpacity={0.6}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={xAt(stand) + (stand > SCREEN_HEIGHT_MAX_METERS * 0.7 ? -4 : 4)}
                y={MARGIN.top + 8}
                fontSize={AXIS_FONT}
                fill="currentColor"
                textAnchor={stand > SCREEN_HEIGHT_MAX_METERS * 0.7 ? 'end' : 'start'}
              >
                Stand {whole.format(standHeightMeters!)} m
              </text>
            </g>
          )}
          <path
            d={path}
            className="text-primary"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {stand !== null && standShare !== null && (
            <circle
              cx={xAt(stand)}
              cy={yAt(standShare)}
              r={4}
              className="fill-primary stroke-background"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {hovered && (
            <g className="text-foreground" pointerEvents="none">
              <line
                x1={xAt(hovered.heightMeters)}
                x2={xAt(hovered.heightMeters)}
                y1={MARGIN.top}
                y2={MARGIN.top + PLOT_H}
                stroke="currentColor"
                strokeOpacity={0.35}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={xAt(hovered.heightMeters)}
                cy={yAt(hovered.hiddenOfVisiblePercent!)}
                r={4}
                className="fill-primary stroke-background"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
          {/* Hit area over the whole plot, so the pointer need not land on the line. */}
          <rect x={MARGIN.left} y={MARGIN.top} width={PLOT_W} height={PLOT_H} fill="transparent" />
        </svg>
        {hovered && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 rounded-md border bg-popover px-2 py-1 text-2xs text-popover-foreground shadow-sm"
            style={
              hovered.heightMeters > SCREEN_HEIGHT_MAX_METERS / 2
                ? { right: `${100 - (xAt(hovered.heightMeters) / WIDTH) * 100 + 2}%` }
                : { left: `${(xAt(hovered.heightMeters) / WIDTH) * 100 + 2}%` }
            }
          >
            <span className="font-semibold text-foreground">{percent(hovered.hiddenOfVisiblePercent!)}</span>{' '}
            <span className="text-muted-foreground">hidden by {whole.format(hovered.heightMeters)} m</span>
          </div>
        )}
      </div>
      <table className="sr-only">
        <caption>Share of the visible ground a screen of each height hides</caption>
        <thead>
          <tr>
            <th scope="col">Screen height, m</th>
            <th scope="col">Visible ground hidden</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.heightMeters}>
              <th scope="row">{whole.format(point.heightMeters)}</th>
              <td>{percent(point.hiddenOfVisiblePercent!)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
