import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/ui/map-panels'
import { StyledSelect } from '@/components/ui/styled-select'
import { iconemViewUrl, WAYBACK_CATALOG, waybackReleases, type WaybackRelease } from './iconem'
import { MAX_TILE_OVERLAYS, uid, type Mission } from './model'

export function WaybackPanel({ mission, change }: { mission: Mission; change: (fn: (m: Mission) => Mission) => void }) {
  const [attempt, setAttempt] = useState(0)
  const [releases, setReleases] = useState<WaybackRelease[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!attempt) return
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch(WAYBACK_CATALOG, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        })
        if (!response.ok) throw new Error(`Esri returned HTTP ${response.status}.`)
        const items = waybackReleases(await response.json())
        if (!controller.signal.aborted) {
          setReleases(items)
          setSelected(items[0].id)
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load releases.')
      }
    }
    void load()
    return () => controller.abort()
  }, [attempt])

  const release = releases.find((item) => item.id === selected)
  const full = mission.tiles.length >= MAX_TILE_OVERLAYS
  const added = release && mission.tiles.some((t) => t.tiles.includes(release.tiles))
  function add() {
    if (!release) return
    const overlay = {
      id: uid(),
      name: `Wayback · ${release.date}`,
      tiles: [release.tiles],
      attribution: release.itemUrl
        ? `<a href="${release.itemUrl}" target="_blank" rel="noopener noreferrer">Esri Wayback · imagery credits</a>`
        : 'Esri World Imagery Wayback and contributors',
      visible: true,
      opacity: 1,
    }
    change((m) =>
      m.tiles.length >= MAX_TILE_OVERLAYS || m.tiles.some((t) => t.tiles.includes(release.tiles))
        ? m
        : { ...m, tiles: [...m.tiles, overlay] },
    )
  }

  return (
    <SidebarSection title="Historical imagery">
      <p className="mm-help">
        Choose an Esri mosaic by release date. A place can have the same imagery across several releases.
      </p>
      {release ? (
        <>
          <label className="mm-field">
            Wayback release
            <StyledSelect value={selected} onChange={(e) => setSelected(e.target.value)}>
              {releases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.date}
                </option>
              ))}
            </StyledSelect>
          </label>
          <Button size="sm" disabled={added || full} onClick={add}>
            {added ? 'Release added' : full ? `${MAX_TILE_OVERLAYS} raster layers in use` : 'Add Wayback layer'}
          </Button>
        </>
      ) : (
        <>
          {error && (
            <p role="alert" className="mm-help">
              {error}
            </p>
          )}
          <Button
            size="sm"
            disabled={attempt > 0 && !error}
            onClick={() => {
              setError('')
              setAttempt((n) => n + 1)
            }}
          >
            {error ? 'Retry Wayback catalog' : attempt ? 'Loading releases…' : 'Browse Wayback releases'}
          </Button>
        </>
      )}
      <a
        className="mm-help underline"
        target="_blank"
        rel="noopener noreferrer"
        href={iconemViewUrl(mission.camera, 'historical', release?.date)}
      >
        Open this location in Iconem historical imagery ↗
      </a>
    </SidebarSection>
  )
}
