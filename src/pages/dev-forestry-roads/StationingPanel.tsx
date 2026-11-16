import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable, engineeringCellInputClass } from '@/components/ui/engineering-table'
import { InlineAlert } from '@/components/ui/map-panels'
import { NumberField } from './Controls'
import { formatRoadStation } from './Charts'
import { useStationReader } from './roadStation'
import { RoadSection } from './SidebarParts'
import {
  calculatedAt,
  checkRoadStationing,
  equationChainage,
  formatStationValue,
  hasStationing,
  keptStationing,
  MAX_ROAD_STATION_EQUATIONS,
  MAX_ROAD_STATION_M,
  MAX_STATION_EQUATION_TEXT,
  resolveTypedStation,
  stationAtChainage,
  type RoadStationEquation,
  type RoadStationing,
} from './roadStationing'
import type { RoadWorkspace } from './useRoadWorkspace'

const NONE: RoadStationing = { startStation: 0, equations: [] }

/**
 * The active road's start station and station equations (`roadStationing.ts`). They rename the
 * road's stations everywhere a station is shown, typed, printed or exported; calculations stay in
 * chainage. Each committed field is one undo step, and a change that would not run along the road
 * is refused with the reason, leaving the road as it was.
 */
export function StationingPanel({ workspace }: { workspace: RoadWorkspace }) {
  const { alignment, analysis, updateAlignment } = workspace
  const readStation = useStationReader(workspace)
  const [error, setError] = useState<string | null>(null)
  const stationing = alignment.stationing ?? NONE
  const length = analysis.length
  const commit = (next: RoadStationing) => {
    try {
      checkRoadStationing(next, length)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    setError(null)
    updateAlignment((road) => {
      const kept = keptStationing(next)
      if (kept) return { ...road, stationing: kept }
      const { stationing: _dropped, ...rest } = road
      void _dropped
      return rest
    })
  }
  const setEquation = (k: number, patch: Partial<RoadStationEquation>) =>
    commit({
      ...stationing,
      equations: stationing.equations.map((e, i) => {
        if (i !== k) return e
        const next = { ...e, ...patch }
        if (!next.description) delete next.description
        if (!next.decreasing) delete next.decreasing
        return next
      }),
    })
  /** The back station is a name before the equation: it is read with the equations before it. */
  const setBack = (k: number, name: number) => {
    const before: RoadStationing = { ...stationing, equations: stationing.equations.slice(0, k) }
    const at = resolveTypedStation(name, before, length, { region: k + 1 })
    if (!at.exact) {
      setError(`Station ${formatStationValue(name)} is not on the road before this equation.`)
      return
    }
    setEquation(k, { back: calculatedAt(at.chainage, stationing) })
  }
  const add = () => {
    const chainage = Math.max(0, Math.min(length, readStation()))
    const back = calculatedAt(chainage, stationing)
    if (stationing.equations.some((e) => Math.abs(e.back - back) < 0.001)) {
      setError(`An equation already stands at ${formatRoadStation(chainage)}.`)
      return
    }
    // Ahead starts as the name the station has now, so adding changes no label until it is edited.
    const equation: RoadStationEquation = { back, ahead: stationAtChainage(chainage, stationing) }
    commit({ ...stationing, equations: [...stationing.equations, equation].sort((a, b) => a.back - b.back) })
  }
  const remove = (k: number) => commit({ ...stationing, equations: stationing.equations.filter((_, i) => i !== k) })
  const summary = hasStationing(alignment.stationing)
    ? `Start ${formatStationValue(stationing.startStation)}${
        stationing.equations.length
          ? ` · ${stationing.equations.length} equation${stationing.equations.length === 1 ? '' : 's'}`
          : ''
      }`
    : 'From 0+000'
  return (
    <RoadSection
      title="Stationing"
      summary={summary}
      data-testid="road-stationing-section"
      help={
        <>
          The station at the road&rsquo;s start and its station equations. From an equation on, stations are named from
          its ahead station; a back equation names some stations twice, and a label then carries its stretch, (2) after
          the first equation. Labels, the station box, tables, reports and exports use these names. Quantities, ranges
          and every calculation stay in distance along the road. LandXML files read and write them as{' '}
          <code>StaEquation</code>; a RoadEng design keeps them in its PGMaps section.
        </>
      }
    >
      <div className="space-y-2">
        <NumberField
          label="Start station (m)"
          ariaLabel="Start station"
          value={stationing.startStation}
          min={-MAX_ROAD_STATION_M}
          max={MAX_ROAD_STATION_M}
          step={1}
          precision={3}
          updateOn="commit"
          onChange={(value) => commit({ ...stationing, startStation: value, equations: shift(stationing, value) })}
        />
        {stationing.equations.length > 0 && (
          <EngineeringTable data-testid="road-station-equations">
            <thead>
              <tr>
                <ColumnHeader label="Back" unit="stn" />
                <ColumnHeader label="Ahead" unit="stn" />
                <ColumnHeader label="Down" title="Stations fall from the ahead station" />
                <ColumnHeader label="Note" />
                <ColumnHeader label="" />
              </tr>
            </thead>
            <tbody>
              {stationing.equations.map((e, k) => (
                <tr key={`${k}-${e.back}`} title={`At ${equationChainage(e, stationing).toFixed(3)} m along the road`}>
                  <td>
                    <NumberField
                      label={`Equation ${k + 1} back station`}
                      hideLabel
                      value={backName(stationing, k)}
                      min={-MAX_ROAD_STATION_M}
                      max={MAX_ROAD_STATION_M}
                      precision={3}
                      updateOn="commit"
                      inputClassName={engineeringCellInputClass}
                      onChange={(value) => setBack(k, value)}
                    />
                  </td>
                  <td>
                    <NumberField
                      label={`Equation ${k + 1} ahead station`}
                      hideLabel
                      value={e.ahead}
                      min={-MAX_ROAD_STATION_M}
                      max={MAX_ROAD_STATION_M}
                      precision={3}
                      updateOn="commit"
                      inputClassName={engineeringCellInputClass}
                      onChange={(value) => setEquation(k, { ahead: value })}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      aria-label={`Equation ${k + 1} stations decrease`}
                      checked={!!e.decreasing}
                      onChange={(event) => setEquation(k, { decreasing: event.target.checked ? true : undefined })}
                    />
                  </td>
                  <td>
                    <input
                      key={e.description ?? ''}
                      className={engineeringCellInputClass}
                      aria-label={`Equation ${k + 1} note`}
                      maxLength={MAX_STATION_EQUATION_TEXT}
                      defaultValue={e.description ?? ''}
                      onBlur={(event) => {
                        const text = event.target.value.trim()
                        if (text !== (e.description ?? '')) setEquation(k, { description: text || undefined })
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') event.currentTarget.blur()
                      }}
                    />
                  </td>
                  <td>
                    <Button
                      size="icon-2xs"
                      variant="ghost"
                      aria-label={`Remove equation ${k + 1}`}
                      title="Remove this equation"
                      onClick={() => remove(k)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </EngineeringTable>
        )}
        <div className="flex flex-wrap gap-1">
          <Button
            size="xs"
            variant="outline"
            disabled={stationing.equations.length >= MAX_ROAD_STATION_EQUATIONS || !(length > 0)}
            onClick={add}
          >
            <Plus className="size-3" />
            Equation at selected station
          </Button>
          {hasStationing(alignment.stationing) && (
            <Button size="xs" variant="ghost" onClick={() => commit(NONE)}>
              Station from 0+000
            </Button>
          )}
        </div>
        {error && <InlineAlert tone="warning">{error}</InlineAlert>}
      </div>
    </RoadSection>
  )
}

/** The name the road has just before equation `k`: its back station. */
function backName(s: RoadStationing, k: number): number {
  const e = s.equations[k]
  const before: RoadStationing = { ...s, equations: s.equations.slice(0, k) }
  return Number(stationAtChainage(equationChainage(e, s), before).toFixed(6))
}

/** Equations keep their place on the road when the start station changes. */
function shift(s: RoadStationing, start: number): RoadStationEquation[] {
  return s.equations.map((e) => ({ ...e, back: start + (e.back - s.startStation) }))
}
