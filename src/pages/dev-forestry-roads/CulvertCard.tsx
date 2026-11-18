import { MapPopup } from '@/components/ui/map'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { MapPopupFit } from '@/components/ui/map-popup-fit'
import { KeyValueRows } from '@/components/ui/map-panels'
import { formatRoadStation } from './Charts'
import { CULVERT_SHAPES, culvertBarrels, culvertPurposeOf, culvertShapeOf, culvertSpanM } from './culverts/culvertShape'
import type { Culvert, CulvertAnalysis } from './engineeringTypes'

/**
 * Culverts closer than this along the road draw on top of one another on the plan, so one click
 * cannot pick between them: the card lists the others.
 */
export const CULVERTS_TOGETHER_M = 2

const mm = (metres: number) => `${Math.round(metres * 1000)} mm`

/** The culvert's opening as a plan label: "Ø 800 mm", or rise × span for any other shape. */
export function culvertOpeningLabel(design: Culvert): string {
  const shape = culvertShapeOf(design)
  const barrels = culvertBarrels(design)
  const opening =
    shape === 'round'
      ? `Ø ${mm(design.diameterM)}`
      : `${CULVERT_SHAPES.find((s) => s.value === shape)?.label ?? shape} ${mm(design.diameterM)} × ${mm(culvertSpanM(design))}`
  return barrels > 1 ? `${barrels} × ${opening}` : opening
}

/**
 * A culvert's figures, opened by clicking its crossing line on the plan. The plan draws the culvert
 * as a line only; its size and name live here so labels never pile up at a station.
 */
export function CulvertCard({
  culvert,
  design,
  together = [],
  onPick,
  onClose,
}: {
  culvert: CulvertAnalysis
  design: Culvert | undefined
  /** The other culverts within `CULVERTS_TOGETHER_M`, with their designs, in station order. */
  together?: { culvert: CulvertAnalysis; design: Culvert | undefined }[]
  onPick?: (id: string) => void
  onClose: () => void
}) {
  const rows: [string, string][] = [
    ['Station', formatRoadStation(culvert.chainage)],
    ...(design ? ([['Opening', culvertOpeningLabel(design)]] as [string, string][]) : []),
    [
      culvert.barrelLengthM !== null ? 'Barrel length' : 'Span',
      `${(culvert.barrelLengthM ?? design?.lengthM ?? culvert.requiredLengthM ?? 0).toFixed(1)} m`,
    ],
    ['Cover', culvert.coverM !== null ? `${culvert.coverM.toFixed(2)} m` : 'Unknown'],
    ...(culvert.gradePercent !== null
      ? ([['Grade', `${culvert.gradePercent.toFixed(1)} %`]] as [string, string][])
      : []),
    ...(design && design.skewDegrees !== 0 ? ([['Skew', `${design.skewDegrees}°`]] as [string, string][]) : []),
  ]
  const purpose = design && culvertPurposeOf(design) === 'stream' ? 'Stream culvert' : 'Cross-drain culvert'
  return (
    <MapPopup
      longitude={culvert.coordinate[0]}
      latitude={culvert.coordinate[1]}
      onClose={onClose}
      // The plan closes it on a click elsewhere: MapLibre's own close-on-click caught the very click
      // on the culvert's marker that opened it.
      closeOnClick={false}
      className="w-60"
    >
      {/* Its warnings can make it taller than a short plan pane: it scrolls rather than running off the map. */}
      <MapPopupFit>
        <MapPopupCard eyebrow={purpose} title={culvert.name} onClose={onClose} closeLabel="Close culvert details">
          <div data-testid="road-culvert-card">
            <KeyValueRows
              variant="grid"
              rows={rows.map(([label, value]) => ({ key: label, label, value }))}
              valueClassName="tabular-nums"
            />
          </div>
          {culvert.warnings.length > 0 && (
            <ul className="space-y-0.5 text-2xs text-warning">
              {culvert.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {together.length > 0 && onPick && (
            <div className="space-y-1 border-t pt-2" data-testid="road-culvert-card-together">
              <div className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
                Also at this station
              </div>
              <ul className="space-y-0.5">
                {together.map((other) => (
                  <li key={other.culvert.id}>
                    <button
                      type="button"
                      className="flex w-full items-baseline justify-between gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-accent"
                      onClick={() => onPick(other.culvert.id)}
                    >
                      <span className={other.culvert.warnings.length ? 'text-warning' : undefined}>
                        {other.culvert.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {other.design ? culvertOpeningLabel(other.design) : formatRoadStation(other.culvert.chainage)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </MapPopupCard>
      </MapPopupFit>
    </MapPopup>
  )
}
