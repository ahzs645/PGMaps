import { useMemo, useState } from 'react'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { formatRoadStation } from './Charts'
import { balanceWhatIf } from './balanceLine'
import type { MassHaulDiagram } from './massHaul'
import type { HaulSite } from './engineeringTypes'

const format = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 0 })
const n = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : format.format(v))

/**
 * The mass-haul diagram's fixed tables: balance points and the loops between them on the zero
 * balance line (the classical reading, `balanceLine.ts`; read only, like the what-if line), and the
 * borrow and waste sites the allocation used. Folded by default under the diagram.
 */
export function MassHaulTables({
  diagram,
  sites,
  freeHaulM,
  onStation,
}: {
  diagram: MassHaulDiagram
  sites?: HaulSite[]
  freeHaulM: number | null
  onStation: (chainage: number) => void
}) {
  const [open, setOpen] = useState(false)
  const zero = useMemo(
    () => (diagram.balance.length > 1 ? balanceWhatIf(diagram.balance, 0, freeHaulM) : null),
    [diagram.balance, freeHaulM],
  )
  const points = useMemo(() => {
    const set = new Set<number>()
    for (const loop of zero?.loops ?? []) {
      if (loop.open !== 'start' && loop.open !== 'both') set.add(Math.round(loop.start * 1000) / 1000)
      if (loop.open !== 'end' && loop.open !== 'both') set.add(Math.round(loop.end * 1000) / 1000)
    }
    return [...set].sort((a, b) => a - b)
  }, [zero])
  const pits = diagram.haul?.pits ?? []
  if (!zero && !pits.length) return null
  const station = (c: number) => (
    <button className="font-mono underline decoration-dotted" onClick={() => onStation(c)}>
      {formatRoadStation(c)}
    </button>
  )
  return (
    <div className="-mx-3 border-t" data-testid="road-mass-tables">
      <button
        className="flex w-full justify-between px-3 py-1 text-3xs text-muted-foreground hover:bg-muted"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          Balance points · {points.length}
          {pits.length ? ` · sites · ${pits.length}` : ''}
        </span>
        <span>{open ? 'Hide −' : 'Show +'}</span>
      </button>
      {open && (
        <div className="grid gap-2 px-3 pb-2">
          {zero && (
            <>
              <p className="text-3xs text-muted-foreground">
                On the zero balance line: between two balance points the cut fills the road there. A loop open at a road
                end is material that comes in (borrow) or leaves (waste) at that end.
                {freeHaulM !== null ? ` Free haul ${n(freeHaulM)} m.` : ''}
              </p>
              <EngineeringTable data-testid="road-balance-loops">
                <thead>
                  <tr>
                    <ColumnHeader label="From" unit="m" className="text-left" />
                    <ColumnHeader label="To" unit="m" className="text-left" />
                    <ColumnHeader label="Moves" />
                    <ColumnHeader label="Volume" unit="m³" />
                    <ColumnHeader label="Mean haul" unit="m" />
                    <ColumnHeader label="Overhaul" unit="m³" />
                    <ColumnHeader label="Ends" />
                  </tr>
                </thead>
                <tbody>
                  {zero.loops.map((loop, i) => (
                    <tr key={i}>
                      <td className="text-left">{station(loop.start)}</td>
                      <td className="text-left">{station(loop.end)}</td>
                      <td>{loop.direction === 'up-station' ? 'Up-station' : 'Down-station'}</td>
                      <td>{n(loop.volumeM3)}</td>
                      <td>{n(loop.meanHaulM)}</td>
                      <td>{freeHaulM === null ? '—' : n(loop.overhaulM3)}</td>
                      <td className="text-left">
                        {loop.open === null
                          ? 'Balances'
                          : loop.open === 'both'
                            ? 'Open both ends'
                            : `Open at the ${loop.open}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="text-left" colSpan={3}>
                      Total · balanced over {n(zero.balancedLengthM)} m
                    </td>
                    <td>{n(zero.volumeM3)}</td>
                    <td>{zero.volumeM3 > 0 ? n(zero.haulM3m / zero.volumeM3) : '—'}</td>
                    <td>{freeHaulM === null ? '—' : n(zero.overhaulM3)}</td>
                    <td />
                  </tr>
                </tfoot>
              </EngineeringTable>
            </>
          )}
          {pits.length > 0 && (
            <EngineeringTable data-testid="road-mass-pit-table">
              <thead>
                <tr>
                  <ColumnHeader label="Site" className="text-left" />
                  <ColumnHeader label="Kind" />
                  <ColumnHeader label="L-Stn" unit="m" className="text-left" />
                  <ColumnHeader label="Access" unit="m" />
                  <ColumnHeader label="Used" unit="m³" />
                  <ColumnHeader label="Capacity" unit="m³" />
                  <ColumnHeader label="Basis" />
                </tr>
              </thead>
              <tbody>
                {pits.map((pit) => {
                  const site = sites?.find((s) => s.id === pit.siteId)
                  return (
                    <tr key={pit.siteId}>
                      <td className="text-left">{pit.name}</td>
                      <td>{pit.kind === 'borrow' ? 'Borrow' : 'Waste'}</td>
                      <td className="text-left">{station(pit.chainage)}</td>
                      <td>{n(site?.accessDistanceM)}</td>
                      <td>{n(pit.volumeM3)}</td>
                      <td>{site ? (site.capacityM3 === null ? 'Unbounded' : n(site.capacityM3)) : '—'}</td>
                      <td>{pit.volumeBasis}</td>
                    </tr>
                  )
                })}
              </tbody>
            </EngineeringTable>
          )}
        </div>
      )}
    </div>
  )
}
