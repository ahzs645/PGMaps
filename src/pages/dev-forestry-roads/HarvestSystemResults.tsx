/**
 * The suggested harvest system map's legend and area table (`harvestSystems.ts`), with the button
 * that runs the three machines. A suggestion from reach alone, and labelled so.
 */
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { InfoTip } from '@/components/ui/info-tip'
import type { HarvestSystemMap } from './harvestSystems'

export function HarvestSystemResults({
  map,
  stale,
  cableNote,
  onRun,
  disabled,
}: {
  map: HarvestSystemMap | null
  /** The inputs changed since the map was made. */
  stale: boolean
  /** Why the cable yarder did not go in, when it did not. */
  cableNote: string | null
  onRun: () => void
  disabled: boolean
}) {
  const rows = map?.rows.filter((row) => row.ha > 0) ?? []
  return (
    <div className="space-y-1.5 border-t pt-2" data-testid="harvest-systems">
      <div className="flex items-center gap-1 font-medium">
        Suggested harvest systems
        <InfoTip label="About suggested harvest systems">
          Runs the skidder, the forwarder and the cable yarder with the settings above on one grid, then suggests a
          system for each cell: ground-based where the skidder or the forwarder reaches, cable where only a skyline
          does, none where no machine does, unknown where any run is unknown. It weighs reach only: no cost, soil,
          season, volume or crew. A suggestion to check, not a prescription.
        </InfoTip>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="h-8 w-full"
        disabled={disabled}
        onClick={onRun}
        data-testid="harvest-systems-run"
      >
        {map ? 'Suggest harvest systems again' : 'Suggest harvest systems'}
      </Button>
      {map && stale && <p className="text-2xs text-muted-foreground">The settings changed since these suggestions.</p>}
      {map && (
        <>
          <div className="overflow-x-auto">
            <EngineeringTable rowHeaders compact data-testid="harvest-system-table">
              <thead>
                <tr>
                  <ColumnHeader label="Suggested system" className="text-left" />
                  <ColumnHeader label="Area" unit="ha" />
                  <ColumnHeader label="Share" unit="%" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.system}>
                    <th scope="row">
                      <span className="mr-1 inline-block size-2 rounded-sm" style={{ background: row.color }} />
                      {row.label}
                    </th>
                    <td>{row.ha.toFixed(1)}</td>
                    <td>{(100 * row.share).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </EngineeringTable>
          </div>
          {cableNote && <p className="text-2xs text-muted-foreground">Cable yarder left out: {cableNote}</p>}
        </>
      )}
    </div>
  )
}
