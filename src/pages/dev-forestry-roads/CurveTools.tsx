import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { NumberField } from './Controls'
import { fitHorizontalRadii, type RadiusFitMode } from './horizontalTools'
import type { RoadWorkspace } from './useRoadWorkspace'

/** Bulk curve tools for the horizontal points: one default radius, or a best fit within a tolerance. */
export function CurveTools({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, project, updateAlignment, setNotice } = workspace
  const [radius, setRadius] = useState(35)
  const [tolerance, setTolerance] = useState(2)
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
  return (
    <div className="mt-3 space-y-2 rounded border p-2" data-testid="road-curve-tools">
      <div className="flex items-end gap-2">
        <div className="w-24">
          <NumberField label="Default radius (m)" value={radius} min={1} max={10000} step={1} onChange={setRadius} />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!corners}
          title="Every corner without a radius gets this one, reduced where its tangents are too short"
          onClick={() => apply({ kind: 'radius', radiusM: radius }, true)}
        >
          Fit sharp corners
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="w-24">
          <NumberField label="Tolerance (m)" value={tolerance} min={0.1} max={500} onChange={setTolerance} />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!corners}
          title="Every corner gets the largest radius whose arc stays within this distance of the pegged corner"
          onClick={() => apply({ kind: 'tolerance', toleranceM: tolerance }, false)}
        >
          Best fit every corner
        </Button>
      </div>
    </div>
  )
}
