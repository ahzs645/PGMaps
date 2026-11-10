import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { NumberField, OptionalNumberField, roadFieldClass } from './Controls'
import { evaluateCurveCriteria, parseWideningTableCsv } from './roadCriteria'
import { centrelineSamples, curveDesignAt, horizontalCurveSummary } from './engine'
import { fitHorizontalRadii, type RadiusFitMode } from './horizontalTools'
import {
  describePolylineFit,
  fitPolylineAlignment,
  fittedMinimumRadius,
  MAX_FIT_DEVIATION_M,
  MIN_FIT_DEVIATION_M,
} from './polylineFit'
import { sectionCrossfall, templateAt } from './templates'
import type { RoadWorkspace } from './useRoadWorkspace'

/** Bulk curve tools for the horizontal points: one default radius, or a best fit within a tolerance. */
/** Field height when the label fits; a narrow pane wraps the label and the button grows rather than clipping. */
const bulkButtonClass = 'h-auto min-h-8 whitespace-normal py-1 leading-tight'

export function CurveTools({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, project, updateAlignment, setNotice } = workspace
  const [radius, setRadius] = useState(35)
  const [tolerance, setTolerance] = useState(2)
  const [spiral, setSpiral] = useState(0)
  const [deviation, setDeviation] = useState(5)
  const corners = Math.max(0, alignment.points.length - 2)
  /** Polyline to alignment: fewer points, a curve at each, within `deviation` of the road as it is. */
  const reduce = () => {
    const limits = { maxDeviationM: deviation, minRadiusM: project.settings.minRadius }
    try {
      // A road that already has curves is followed along them, not along the corners they cut.
      const centre = alignment.points.some((p) => p.radiusM > 0) ? centrelineSamples(alignment, 2) : null
      const line = centre
        ? centre.samples.map((sample) => centre.toCoordinate(sample.x, sample.y))
        : alignment.points.map((p) => p.coordinate)
      const fit = fitPolylineAlignment(line, limits)
      const last = fit.points.length - 1
      updateAlignment((a) => ({
        ...a,
        points: fit.points.map((point, i) => ({
          id: i === 0 ? a.points[0].id : i === last ? a.points[a.points.length - 1].id : crypto.randomUUID(),
          ...point,
        })),
      }))
      setNotice(
        describePolylineFit({ ...fit, sourcePoints: alignment.points.length }, limits) +
          (fit.sharpCorners ? ' “Fit sharp corners” gives them the largest curve their tangents hold.' : '') +
          (alignment.vertical.length || alignment.overrides.length
            ? ' Stations along the road have moved: check the profile and anything set by station.'
            : ''),
      )
    } catch (cause) {
      workspace.setError(cause instanceof Error ? cause.message : 'Could not reduce this line.')
    }
  }
  const apply = (mode: RadiusFitMode, onlySharp: boolean) => {
    const { points, report } = fitHorizontalRadii(alignment.points, mode, {
      minRadiusM: project.settings.minRadius,
      onlySharp,
    })
    updateAlignment((a) => ({ ...a, points }))
    const shrunk = report.filter((r) => r.limitedBy === 'tangents').length
    const below = report.filter((r) => r.belowMinimum).length
    setNotice(
      `Set ${report.length} curve${report.length === 1 ? '' : 's'}` +
        (shrunk ? `; ${shrunk} reduced to fit short tangents` : '') +
        (below ? `; ${below} below the ${project.settings.minRadius} m minimum radius` : '') +
        '.',
    )
  }
  const setSpirals = () => {
    updateAlignment((a) => ({
      ...a,
      points: a.points.map((p) => {
        const { spiralM: _old, ...rest } = p
        void _old
        return spiral > 0 && p.radiusM > 0 ? { ...rest, spiralM: spiral } : rest
      }),
    }))
    setNotice(spiral > 0 ? `Set ${spiral} m spirals on every curve.` : 'Removed the spirals.')
  }
  // Each row is the action and the one value it uses, so the four tools read as a short list.
  return (
    <div className="mt-2 rounded-md border p-2" data-testid="road-curve-tools">
      <p className="mb-1 text-xs font-medium">Bulk curve tools</p>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-end gap-x-2 gap-y-1.5">
        <Button
          size="sm"
          variant="outline"
          className={bulkButtonClass}
          disabled={!corners}
          data-testid="road-reduce-points"
          title={`Polyline to alignment: keeps as few points as will hold the line within this distance, with a curve of at least ${
            project.settings.minRadius > 0
              ? `the ${project.settings.minRadius} m minimum radius`
              : `${fittedMinimumRadius(0)} m (no minimum radius is set)`
          } at each`}
          onClick={reduce}
        >
          Reduce points, fit curves
        </Button>
        <NumberField
          label="Max deviation (m)"
          value={deviation}
          min={MIN_FIT_DEVIATION_M}
          max={MAX_FIT_DEVIATION_M}
          onChange={setDeviation}
        />
        <Button
          size="sm"
          variant="outline"
          className={bulkButtonClass}
          disabled={!corners}
          title="Every corner without a radius gets this one, reduced where its tangents are too short"
          onClick={() => apply({ kind: 'radius', radiusM: radius }, true)}
        >
          Fit sharp corners
        </Button>
        <NumberField label="Radius (m)" value={radius} min={1} max={10000} step={1} onChange={setRadius} />
        <Button
          size="sm"
          variant="outline"
          className={bulkButtonClass}
          disabled={!corners}
          title="Every corner gets the largest radius whose arc stays within this distance of the pegged corner"
          onClick={() => apply({ kind: 'tolerance', toleranceM: tolerance }, false)}
        >
          Best fit every corner
        </Button>
        <NumberField label="Tolerance (m)" value={tolerance} min={0.1} max={500} onChange={setTolerance} />
        <Button
          size="sm"
          variant="outline"
          className={bulkButtonClass}
          disabled={!alignment.points.some((p) => p.radiusM > 0)}
          title="Clothoid transitions of this length on both sides of every curve; 0 removes them"
          onClick={setSpirals}
        >
          Set spirals on every curve
        </Button>
        <NumberField label="Spirals (m)" value={spiral} max={2000} step={5} onChange={setSpiral} />
      </div>
    </div>
  )
}

const CURVE_DESIGN_START = {
  designSpeedKmh: 40,
  maxSuperelevationPercent: 8,
  sideFrictionFactor: 0.15,
  runoffLengthM: 30,
  wideningVehicleLengthM: null,
}

export const CURVE_DESIGN_HELP =
  'Required e = V²/(127 R) − f; the rotation target is capped at the entered maximum. The section retains its ' +
  'template crown, so actual crossfall can differ. Inside widening uses L²/(2R) unless a table is entered. ' +
  'Transitions run in before the circular arc. Leave the speed empty for none. The values are entries, not a ' +
  'road-class standard. Name the criteria and record its source. Conflicting speed/radius/e-max is flagged; widening tables are radius, deflection, inside, outside.'

/** Design-speed superelevation and curve widening for the active road; an empty speed turns it off. */
export function CurveDesignControls({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, updateAlignment } = workspace
  const design = alignment.curveDesign
  const [tableText, setTableText] = useState('')
  const [tableError, setTableError] = useState('')
  const curveRows = (() => {
    try {
      return horizontalCurveSummary(alignment)
    } catch {
      return []
    }
  })()
  const set = (patch: Partial<NonNullable<typeof design>>) =>
    updateAlignment((a) => ({ ...a, curveDesign: { ...(a.curveDesign ?? CURVE_DESIGN_START), ...patch } }))
  return (
    <div className="space-y-2" data-testid="road-curve-design">
      <div className="grid grid-cols-2 gap-2">
        <OptionalNumberField
          label="Design speed (km/h)"
          value={design?.designSpeedKmh ?? null}
          min={1}
          max={150}
          step={5}
          onChange={(designSpeedKmh) =>
            designSpeedKmh === null
              ? updateAlignment((a) => {
                  const { curveDesign: _off, ...rest } = a
                  void _off
                  return rest
                })
              : set({ designSpeedKmh })
          }
        />
        {design && (
          <>
            <label className="col-span-2 text-xs">
              Criteria name
              <input
                className={roadFieldClass}
                aria-label="Road criteria name"
                maxLength={200}
                value={design.criteriaName ?? ''}
                onChange={(e) => set({ criteriaName: e.target.value })}
              />
            </label>
            <label className="col-span-2 text-xs">
              Criteria source / edition
              <input
                className={roadFieldClass}
                aria-label="Road criteria source"
                maxLength={2000}
                value={design.criteriaSource ?? ''}
                onChange={(e) => set({ criteriaSource: e.target.value })}
              />
            </label>
            <NumberField
              label="Max superelevation (%)"
              value={design.maxSuperelevationPercent}
              max={20}
              onChange={(maxSuperelevationPercent) => set({ maxSuperelevationPercent })}
            />
            <NumberField
              label="Side friction f"
              value={design.sideFrictionFactor}
              max={1}
              step={0.01}
              onChange={(sideFrictionFactor) => set({ sideFrictionFactor })}
            />
            <NumberField
              label="Runoff (m)"
              value={design.runoffLengthM}
              max={1000}
              step={5}
              onChange={(runoffLengthM) => set({ runoffLengthM })}
            />
            <OptionalNumberField
              label="Widening vehicle (m)"
              placeholder="none"
              value={design.wideningVehicleLengthM}
              min={0}
              max={50}
              onChange={(wideningVehicleLengthM) => set({ wideningVehicleLengthM })}
            />
            <NumberField
              label="Extra inside widening (m)"
              value={design.insideWideningM ?? 0}
              max={50}
              onChange={(insideWideningM) => set({ insideWideningM })}
            />
            <NumberField
              label="Extra outside widening (m)"
              value={design.outsideWideningM ?? 0}
              max={50}
              onChange={(outsideWideningM) => set({ outsideWideningM })}
            />
          </>
        )}
      </div>
      {design && (
        <>
          <details className="text-xs">
            <summary className="cursor-pointer">Widening table · {design.wideningTable?.length ?? 0} entries</summary>
            <p className="my-1 text-muted-foreground">
              CSV rows: radius m, deflection degrees, inside m, outside m. Include every combination. The table replaces
              vehicle-formula widening; extra widths are added.
            </p>
            <textarea
              className={`${roadFieldClass} min-h-24 w-full`}
              aria-label="Curve widening table CSV"
              value={tableText}
              placeholder="50,90,2,0"
              onChange={(e) => setTableText(e.target.value)}
            />
            <div className="mt-1 flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  try {
                    set({ wideningTable: parseWideningTableCsv(tableText) })
                    setTableError('')
                  } catch (e) {
                    setTableError(e instanceof Error ? e.message : 'Invalid table')
                  }
                }}
              >
                Apply widening table
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTableText(
                    (design.wideningTable ?? [])
                      .map((r) => [r.radiusM, r.deflectionDegrees, r.insideM, r.outsideM].join(','))
                      .join('\n'),
                  )
                  setTableError('')
                }}
              >
                Load current table
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  set({ wideningTable: undefined })
                  setTableError('')
                }}
              >
                Use vehicle formula
              </Button>
            </div>
            {tableError && <InlineAlert tone="error">{tableError}</InlineAlert>}
          </details>
          {curveRows.length > 0 && (
            <div className="overflow-x-auto text-2xs" data-testid="road-speed-criteria-review">
              <EngineeringTable>
                <thead>
                  <tr>
                    <ColumnHeader label="Radius" />
                    <ColumnHeader label="Required e" />
                    <ColumnHeader label="Capped target" />
                    <ColumnHeader label="Actual I / O" />
                  </tr>
                </thead>
                <tbody>
                  {curveRows.map((r, i) => {
                    const c = evaluateCurveCriteria(design, r.radius, r.deflectionDegrees)
                    const midpoint = (r.start + r.end) / 2
                    const resolved = templateAt(alignment, midpoint).template
                    const fitted = curveDesignAt(alignment, midpoint)
                    const inside = sectionCrossfall(resolved, r.direction, fitted)
                    const outside = sectionCrossfall(resolved, r.direction === 'left' ? 'right' : 'left', fitted)
                    return (
                      <tr key={i} className={c.warnings.length ? 'text-amber-700 dark:text-amber-400' : ''}>
                        <td title={`Full deflection ${r.deflectionDegrees.toFixed(1)}° including spirals`}>
                          {r.radius.toFixed(1)} m
                        </td>
                        <td>{c.requiredSuperelevationPercent.toFixed(2)}%</td>
                        <td>{c.appliedSuperelevationPercent.toFixed(2)}%</td>
                        <td>
                          {inside.toFixed(2)} / {outside.toFixed(2)}%
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </EngineeringTable>
              <p className="mt-1 text-muted-foreground">
                Speed requires radius ≥ {evaluateCurveCriteria(design, 100).minimumSpeedRadiusM.toFixed(1)} m. Criteria
                are entered assumptions until supported by the recorded source.
              </p>
              <p className="mt-1 text-muted-foreground">
                Actual I/O is inside/outside crossfall at the circular-arc midpoint; positive falls away from the
                centreline. Template crown and runoff determine the actual section. Widening is evaluated per fitted
                curve, using full deflection including spirals; a compound switchback still needs a complete vehicle
                maneuver and swept-path review. Data → Horizontal curves shows the full station review.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
