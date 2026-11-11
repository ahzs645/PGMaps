import { createContext, useContext, type ReactNode } from 'react'

/**
 * The selected station for the design sidebar. The sidebar is memoized (`memoWithLatestHandlers`)
 * so a hover along the road does not re-render it; the page therefore hands it a workspace whose
 * `station` is NaN, and the sidebar reads the station here instead:
 *
 * - `useLiveStation` / `StationValue` for what it shows (they re-render with the station), and
 * - `useStationReader` for what a click does (it reads the station then, and re-renders nothing).
 *
 * Without the page's providers (a component test, a mount outside the sidebar) both fall back to
 * `workspace.station`.
 */
const LiveStation = createContext<number | null>(null)
const StationReader = createContext<(() => number) | null>(null)

export function RoadStationProvider({
  station,
  read,
  children,
}: {
  station: number
  /** Stable; returns the station as of the last commit. */
  read: () => number
  children: ReactNode
}) {
  return (
    <StationReader.Provider value={read}>
      <LiveStation.Provider value={station}>{children}</LiveStation.Provider>
    </StationReader.Provider>
  )
}

export function useLiveStation(workspace: { station: number }): number {
  return useContext(LiveStation) ?? workspace.station
}

export function useStationReader(workspace: { station: number }): () => number {
  const read = useContext(StationReader)
  return read ?? (() => workspace.station)
}

/** Renders `children` with the live station, so only this part follows a hover. */
export function StationValue({
  workspace,
  children,
}: {
  workspace: { station: number }
  children: (station: number) => ReactNode
}) {
  return <>{children(useLiveStation(workspace))}</>
}
