import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import {
  bankfullAreaCheck,
  channelWidthEvidence,
  type BankfullReading,
  type CrossingChannelReading,
  NATURAL_CHANNEL,
  readCrossingChannel,
  streamWidthRatioCheck,
} from './culverts/naturalChannel'
import { terrainResolution } from './tinGround'
import type { Coordinate, ContextFeature, Crossing, Culvert, TerrainMetadata, TerrainSource } from './types'

/** Readings shown per stream; a stream crossed more often lists the first ones by road order. */
const MAX_READINGS = 3
const trim = (value: number, digits = 2) => String(Number(value.toFixed(digits)))

/**
 * The candidate bankfull read from the terrain at each road crossing of one stream. Display only:
 * **Use** is the one way a width read here reaches the stream's channel width, on the reviewer's
 * click. It never sets a class.
 */
export function NaturalChannelPanel({
  stream,
  crossings,
  terrain,
  terrainMeta,
  recordedWidthM,
  onUse,
  culvertsAt,
}: {
  stream: ContextFeature
  /** This stream's crossings on every road. */
  crossings: readonly Crossing[]
  terrain: TerrainSource
  terrainMeta: TerrainMetadata
  recordedWidthM: number | null
  onUse: (widthM: number) => void
  /** The stream culverts placed at a crossing, for the 3 × area and width-ratio screens under its reading. */
  culvertsAt?: (crossing: Crossing) => readonly Culvert[]
}) {
  const cellSizeM = terrainResolution(terrainMeta).spacingM
  const line = stream.geometry.type === 'LineString' ? (stream.geometry.coordinates as Coordinate[]) : null
  const key = crossings
    .slice(0, MAX_READINGS)
    .map((c) => c.coordinate.join(','))
    .join(';')
  const readings = useMemo(() => {
    if (!line || !key) return []
    return key.split(';').map((c) => {
      const crossing = c.split(',').map(Number) as Coordinate
      return readCrossingChannel({ terrain, streamLine: line, crossing, cellSizeM })
    })
  }, [line, key, terrain, cellSizeM])
  if (!line || !crossings.length) return null
  return (
    <div className={cn(insetBox({ tone: 'muted' }), 'space-y-2 text-2xs')} data-testid="road-stream-natural-channel">
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 text-xs font-medium">Channel read from the terrain</p>
        <InfoTip label="About the channel reading">
          A section of the existing ground {NATURAL_CHANNEL.upstreamM} m upstream of each crossing, square to the
          stream, at the terrain&apos;s {trim(cellSizeM)} m resolution. Bankfull is the first bench: the lowest stage
          where the waterline spreads onto ground flatter than 1 in 10 (Riley 1972 bench index), with the width-to-depth
          minimum (Wolman 1955) beside it. It is a candidate for the reviewer, not a field measurement, and never a
          class: on 1 m LiDAR each bank is placed to within about a cell, and a channel under about four cells wide, or
          one whose bed LiDAR read as water, is flagged.
        </InfoTip>
      </div>
      {readings.map((r, i) =>
        r ? (
          <CrossingReading
            key={i}
            index={i}
            reading={r}
            recordedWidthM={recordedWidthM}
            onUse={onUse}
            multiple={readings.length > 1}
            culverts={culvertsAt?.(crossings[i]) ?? []}
          />
        ) : (
          <p key={i} className="text-muted-foreground">
            Crossing {i + 1}: the stream line cannot place a section.
          </p>
        ),
      )}
      {crossings.length > MAX_READINGS && (
        <p className="text-muted-foreground">
          {crossings.length - MAX_READINGS} more crossing{crossings.length - MAX_READINGS === 1 ? '' : 's'} not read.
        </p>
      )}
    </div>
  )
}

function CrossingReading({
  index,
  reading: { location, reading },
  recordedWidthM,
  onUse,
  multiple,
  culverts,
}: {
  index: number
  reading: CrossingChannelReading
  recordedWidthM: number | null
  onUse: (widthM: number) => void
  multiple: boolean
  culverts: readonly Culvert[]
}) {
  // The same screens the culvert's checks print (`culvertChecks`), here with this reading's area.
  const screens = culverts.flatMap((culvert) =>
    [
      bankfullAreaCheck({ culvert, reading }),
      streamWidthRatioCheck({ culvert, channel: channelWidthEvidence(recordedWidthM, reading) }),
    ].flatMap((check) => (check ? [{ culvert, check }] : [])),
  )
  const width = reading.widthM === null ? null : Number(reading.widthM.toFixed(1))
  const inUse = width !== null && recordedWidthM === width
  const bound = reading.lowerBound ? 'at least ' : ''
  return (
    <div className="space-y-1" data-testid="road-stream-channel-reading">
      {multiple && <p className="font-medium">Crossing {index + 1}</p>}
      <p className="text-muted-foreground">Section {location.note}.</p>
      {reading.state === 'read' ? (
        <p>
          Candidate bankfull width <span className="font-semibold">{trim(reading.widthM!, 1)} m</span>, mean depth{' '}
          {bound}
          {trim(reading.meanDepthM!)} m, max depth {bound}
          {trim(reading.maxDepthM!)} m, area {bound}
          {trim(reading.areaM2!)} m², width:depth {trim(reading.widthDepthRatio!, 1)}
        </p>
      ) : (
        <p className="text-warning">Not read: {reading.reason}</p>
      )}
      <SectionSketch reading={reading} />
      {reading.flags.map((flag) => (
        <p key={flag.id} className={flag.id === 'gap' ? 'text-muted-foreground' : 'text-warning'}>
          {flag.text}
        </p>
      ))}
      {reading.state === 'read' && (
        <div className="flex items-center gap-1">
          <Button
            size="2xs"
            variant="outline"
            disabled={!reading.usable || inUse || width === null}
            onClick={() => width !== null && onUse(width)}
          >
            {inUse ? 'In use as channel width' : `Use ${width} m as channel width`}
          </Button>
          {!reading.usable && <span className="text-muted-foreground">Too coarse to offer as a width.</span>}
        </div>
      )}
      {screens.length > 0 && (
        <ul className="space-y-0.5" data-testid="road-stream-channel-screens">
          {screens.map(({ culvert, check }) => (
            <li
              key={`${culvert.id}-${check.id}`}
              className={
                check.state === 'not-met'
                  ? 'text-warning'
                  : check.state === 'met'
                    ? 'text-success'
                    : 'text-muted-foreground'
              }
              title={`${check.judgedOn}. ${check.locator}`}
            >
              {culvert.name}: {check.label.toLowerCase()} — {CHECK_STATE_TEXT[check.state]}. {check.result}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const CHECK_STATE_TEXT = { met: 'met', 'not-met': 'not met', 'not-assessed': 'not assessed', note: 'note' } as const

const SKETCH_W = 240,
  SKETCH_H = 72,
  PAD = 4

/** The sampled section, gaps left open, with the bankfull waterline. */
function SectionSketch({ reading }: { reading: BankfullReading }) {
  const { samples } = reading.section
  const known = samples.filter((s) => s.elevationM !== null)
  if (known.length < 2) return null
  const lo = Math.min(...known.map((s) => s.elevationM!)),
    hi = Math.max(...known.map((s) => s.elevationM!), reading.stageM ?? -Infinity)
  const x0 = samples[0].offsetM,
    x1 = samples[samples.length - 1].offsetM
  const sx = (x: number) => PAD + ((x - x0) / (x1 - x0 || 1)) * (SKETCH_W - 2 * PAD)
  const sy = (z: number) => SKETCH_H - PAD - ((z - lo) / (hi - lo || 1)) * (SKETCH_H - 2 * PAD)
  // One path; a gap starts a new run.
  let d = '',
    pen = false
  for (const s of samples) {
    if (s.elevationM === null) {
      pen = false
      continue
    }
    d += `${pen ? 'L' : 'M'}${sx(s.offsetM).toFixed(1)} ${sy(s.elevationM).toFixed(1)}`
    pen = true
  }
  const stage = reading.stageM
  return (
    <svg
      viewBox={`0 0 ${SKETCH_W} ${SKETCH_H}`}
      className="h-auto w-full"
      role="img"
      aria-label={
        stage === null
          ? 'Sampled channel section'
          : `Sampled channel section with the candidate bankfull line ${trim(reading.widthM!, 1)} m wide`
      }
    >
      <title>Left bank (looking downstream) on the left; vertical scale exaggerated</title>
      {stage !== null && reading.leftBankOffsetM !== null && reading.rightBankOffsetM !== null && (
        <line
          className="text-primary"
          stroke="currentColor"
          strokeWidth={1.5}
          x1={sx(reading.leftBankOffsetM)}
          x2={sx(reading.rightBankOffsetM)}
          y1={sy(stage)}
          y2={sy(stage)}
        />
      )}
      <path d={d} fill="none" className="text-foreground" stroke="currentColor" strokeWidth={1} />
      {reading.thalweg && (
        <circle
          className="text-primary"
          fill="currentColor"
          cx={sx(reading.thalweg.offsetM)}
          cy={sy(reading.thalweg.elevationM)}
          r={2}
        />
      )}
    </svg>
  )
}
