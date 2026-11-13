import { MapPopup } from '@/components/ui/map'
import { MapPopupCard } from '@/components/ui/map-popup-card'
import { KeyValueRows } from '@/components/ui/map-panels'
import { Button } from '@/components/ui/button'
import { harvestAgeSummary } from './harvestHistory'
import { pathLengthM, polygonAreaM2 } from './mapNotes'
import type { ContextFeature, Coordinate } from './types'

const SOURCE_LABELS = {
  'bc-consolidated': 'BC consolidated cutblocks',
  'bc-ften': 'BC FTEN cutblock record',
  user: 'Imported harvest evidence',
  scenario: 'Synthetic teaching record',
} as const

/** A cutblock's footprint and harvest record, where it was clicked on the plan. */
export function CutblockCard({
  feature,
  at,
  year,
  onClose,
  onOpenHistory,
  onAccessHistory,
}: {
  feature: ContextFeature
  at: Coordinate
  year: number
  onClose: () => void
  /** The full evidence and nearby roads, in the sidebar's cutblock history. */
  onOpenHistory?: () => void
  onAccessHistory?: () => void
}) {
  const evidence = feature.harvestEvidence
  const isProposed = evidence?.status === 'proposed'
  const sourceLabel =
    evidence && (isProposed && evidence.source === 'user' ? 'User-provided cutblock' : SOURCE_LABELS[evidence.source])
  const polygon = feature.geometry.type === 'Polygon' ? feature.geometry : null
  const mappedHa = polygon ? polygonAreaM2(polygon) / 10000 : null
  const perimeterM = polygon ? pathLengthM(polygon.coordinates[0] as Coordinate[]) : null
  // A source's recorded area and the drawn footprint can disagree; show both when they do.
  const recordedHa = evidence?.areaHectares
  const differs = recordedHa !== undefined && mappedHa !== null && Math.abs(recordedHa - mappedHa) > 0.05 * recordedHa
  const years =
    evidence?.startYear !== undefined && evidence.endYear !== undefined && evidence.startYear !== evidence.endYear
      ? `${evidence.startYear}–${evidence.endYear}`
      : (evidence?.endYear ?? evidence?.startYear ?? evidence?.midYear)
  const rows: [string, string][] = [
    ...(mappedHa !== null ? ([['Area', `${mappedHa.toFixed(2)} ha`]] as [string, string][]) : []),
    ...(differs ? ([['Recorded area', `${recordedHa!.toFixed(2)} ha`]] as [string, string][]) : []),
    ...(perimeterM !== null
      ? ([
          ['Perimeter', perimeterM >= 1000 ? `${(perimeterM / 1000).toFixed(2)} km` : `${Math.round(perimeterM)} m`],
        ] as [string, string][])
      : []),
    ...(years !== undefined ? ([['Harvest', String(years)]] as [string, string][]) : []),
    ...(evidence?.openingId ? ([['Opening ID', evidence.openingId]] as [string, string][]) : []),
    ...(sourceLabel ? ([['Source', sourceLabel]] as [string, string][]) : []),
  ]
  return (
    <MapPopup longitude={at[0]} latitude={at[1]} onClose={onClose} className="w-64">
      <MapPopupCard
        eyebrow={isProposed ? 'Proposed cutblock' : 'Cutblock'}
        title={feature.name}
        subtitle={isProposed ? 'No harvest history recorded' : harvestAgeSummary(evidence, year)}
        onClose={onClose}
        closeLabel="Close cutblock details"
        actions={
          (onOpenHistory || onAccessHistory) && (
            <div className="grid w-full gap-1.5">
              {onOpenHistory && (
                <Button size="xs" variant="outline" className="w-full" onClick={onOpenHistory}>
                  Review cutblock
                </Button>
              )}
              {onAccessHistory && (
                <Button size="xs" variant="ghost" className="w-full" onClick={onAccessHistory}>
                  Access evidence
                </Button>
              )}
            </div>
          )
        }
      >
        <div data-testid="road-cutblock-card">
          <KeyValueRows
            variant="grid"
            rows={rows.map(([label, value]) => ({ key: label, label, value }))}
            valueClassName="tabular-nums"
          />
        </div>
        {differs && (
          <p className="text-2xs text-muted-foreground">
            Area is measured from the drawn footprint; the source records its own figure.
          </p>
        )}
      </MapPopupCard>
    </MapPopup>
  )
}
