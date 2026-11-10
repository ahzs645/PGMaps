import { useState } from 'react'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { NumberField } from './Controls'
import { formatRoadStation } from './Charts'
import {
  FIT_MIN_TANGENT_LIMITS,
  FIT_TOLERANCE_LIMITS,
  fitRoadGeometry,
  POORLY_DETERMINED_SHARE,
  type RoadGeometryFit,
} from './leastSquaresFit'
import type { DesignPoints } from './mappedRoad'
import { RoadSection } from './SidebarParts'
import type { RoadWorkspace } from './useRoadWorkspace'

const n = (value: number, digits = 1) =>
  value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits })

/**
 * Least-squares tangents and curves of the active mapped road (`leastSquaresFit.ts`), with each
 * bend's fit quality, and a copy of the fitted geometry as an editable design.
 */
export function RoadGeometryFitPanel({
  workspace,
  full,
  onCopy,
}: {
  workspace: RoadWorkspace
  full: boolean
  onCopy: (points: DesignPoints) => void
}) {
  const { alignment, project, setStation } = workspace
  const [toleranceM, setTolerance] = useState(project.terrain.resolutionM <= 2 ? 0.5 : 2)
  const [minTangentM, setMinTangent] = useState(30)
  const [spirals, setSpirals] = useState(false)
  const [result, setResult] = useState<{ key: string; fit: RoadGeometryFit | null; error: string | null } | null>(null)
  const key = JSON.stringify([
    alignment.id,
    alignment.points.map((p) => p.coordinate),
    toleranceM,
    minTangentM,
    spirals,
  ])
  const current = result?.key === key ? result : null
  const run = () => {
    try {
      const fit = fitRoadGeometry(
        alignment.points.map((p) => p.coordinate),
        { toleranceM, minTangentM, spirals, minRadiusM: 0 },
      )
      setResult({ key, fit, error: null })
    } catch (cause) {
      setResult({ key, fit: null, error: cause instanceof Error ? cause.message : 'The line could not be fitted.' })
    }
  }
  const fit = current?.fit ?? null
  const fitted = fit?.bends.filter((bend) => bend.status === 'fitted').length ?? 0
  return (
    <RoadSection
      title="Fit geometry"
      summary={fit ? `${fit.tangents.length} tangents · ${fitted} curves` : 'Not fitted'}
      help={
        <>
          Finds the straight runs of the mapped line by least squares (a run is a tangent while no point is further than
          the tolerance from its fitted line) and, between each pair of tangents, the radius that best follows the line,
          with the tangents held fixed. With spirals, a spiral length is fitted on each side too. Each bend shows its
          RMS and largest offset, and the radius&rsquo;s standard error: when that is more than{' '}
          {POORLY_DETERMINED_SHARE * 100}% of the radius the bend is too short or too noisy to fix its radius. A bend
          whose tangents do not meet is left as the line&rsquo;s own vertices. The fit reads the road&rsquo;s points as
          loaded, after thinning.
        </>
      }
      data-testid="road-geometry-fit-section"
    >
      <div className="grid grid-cols-2 items-end gap-2">
        <NumberField
          label="Tangent tolerance (m)"
          value={toleranceM}
          min={FIT_TOLERANCE_LIMITS[0]}
          max={FIT_TOLERANCE_LIMITS[1]}
          step={0.05}
          hint="The largest offset of a point from a tangent's fitted line: about 0.5 m on a LiDAR trace, 2 m on a map line."
          onChange={setTolerance}
        />
        <NumberField
          label="Shortest tangent (m)"
          value={minTangentM}
          min={FIT_MIN_TANGENT_LIMITS[0]}
          max={FIT_MIN_TANGENT_LIMITS[1]}
          step={5}
          onChange={setMinTangent}
        />
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={spirals} onChange={(event) => setSpirals(event.target.checked)} />
          Fit spirals
        </label>
        <Button size="sm" variant="outline" onClick={run} disabled={alignment.points.length < 2}>
          Fit
        </Button>
      </div>
      {current?.error && <InlineAlert tone="warning">{current.error}</InlineAlert>}
      {fit && (
        <>
          <p className="text-2xs text-muted-foreground" data-testid="road-geometry-fit-result">
            {fit.tangents.length} tangents, {fitted} of {fit.bends.length} bends fitted. The fitted centreline stays
            within {n(fit.maxDeviationM)} m of the line.
          </p>
          {fit.bends.length > 0 && (
            <div className="max-h-48 overflow-auto">
              <EngineeringTable>
                <thead className="sticky top-0">
                  <tr>
                    <ColumnHeader label="Bend" />
                    <ColumnHeader label="R" unit="m" />
                    <ColumnHeader label="±σ" unit="m" />
                    {spirals && <ColumnHeader label="Ls" unit="m" />}
                    <ColumnHeader label="Δ" unit="°" />
                    <ColumnHeader label="RMS" unit="m" />
                    <ColumnHeader label="Max" unit="m" />
                  </tr>
                </thead>
                <tbody>
                  {fit.bends.map((bend, index) => {
                    const corner = bend.corner
                    return (
                      <tr
                        key={index}
                        className="cursor-pointer"
                        title={bend.reason ?? (corner?.poorlyDetermined ? 'Radius poorly determined' : undefined)}
                        onClick={() => setStation(bend.chainage)}
                      >
                        <td>{formatRoadStation(bend.chainage)}</td>
                        {corner ? (
                          <>
                            <td className={corner.poorlyDetermined ? 'text-amber-700 dark:text-amber-400' : undefined}>
                              {n(corner.radiusM)}
                              {corner.poorlyDetermined ? '?' : ''}
                            </td>
                            <td>{corner.radiusSigmaM === null ? '—' : n(corner.radiusSigmaM)}</td>
                            {spirals && <td>{n(corner.spiralM)}</td>}
                            <td>{n((Math.abs(corner.deflection) * 180) / Math.PI)}</td>
                            <td>{n(corner.rmsM, 2)}</td>
                            <td>{n(corner.maxResidualM, 2)}</td>
                          </>
                        ) : (
                          <td colSpan={spirals ? 6 : 5} className="text-left text-muted-foreground">
                            Not fitted
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </EngineeringTable>
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-1"
            disabled={full}
            onClick={() => onCopy(fit.points)}
          >
            <Copy className="size-3" /> Copy fitted geometry as design
          </Button>
        </>
      )}
    </RoadSection>
  )
}
