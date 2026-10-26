import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { NumberField, OptionalNumberField } from './Controls'
import { fitHorizontalRadii, type RadiusFitMode } from './horizontalTools'
import type { RoadWorkspace } from './useRoadWorkspace'

/** Bulk curve tools for the horizontal points: one default radius, or a best fit within a tolerance. */
export function CurveTools({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, project, updateAlignment, setNotice } = workspace
  const [radius, setRadius] = useState(35)
  const [tolerance, setTolerance] = useState(2)
  const [spiral, setSpiral] = useState(0)
  const corners = Math.max(0, alignment.points.length - 2)
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
  // Each row is the action and the one value it uses, so the three tools read as a short list.
  return (
    <div className="mt-2 rounded-md border p-2" data-testid="road-curve-tools">
      <p className="mb-1 text-xs font-medium">Bulk curve tools</p>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-end gap-x-2 gap-y-1.5">
        <Button
          size="sm"
          variant="outline"
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
  'e = V²/(127 R) − f, between the crown and the maximum, rotated about the centreline; inside widening L²/(2R). ' +
  'Both run in over the runoff before each curve. Leave the speed empty for none. The values are entries, not a ' +
  'road-class standard.'

/** Design-speed superelevation and curve widening for the active road; an empty speed turns it off. */
export function CurveDesignControls({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, updateAlignment } = workspace
  const design = alignment.curveDesign
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
          </>
        )}
      </div>
    </div>
  )
}
