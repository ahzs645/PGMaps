import { useEffect, useState } from 'react'
import { imageryCitationUrl, parseImageryCitations, type ImageryCitation } from './basemaps'

/** Tile-centre provenance is deliberately not presented as metadata for every pixel. */
export function ImageryProvenance({ bounds }: { bounds: [number, number, number, number] }) {
  const [citations, setCitations] = useState<ImageryCitation[]>([])
  const [status, setStatus] = useState('Loading imagery source information…')
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12_000)
    let active = true
    fetch(imageryCitationUrl((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('Imagery metadata unavailable')
        return parseImageryCitations(await response.json())
      })
      .then((rows) => {
        if (active) {
          setCitations(rows)
          setStatus(rows.length ? '' : 'No source metadata was returned at the tile centre.')
        }
      })
      .catch(() => {
        if (active) setStatus('Imagery source metadata is unavailable. Collection date is unverified.')
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [bounds])
  const unique = citations.filter(
    (row, index, rows) =>
      rows.findIndex(
        (other) => other.source === row.source && other.date === row.date && other.resolution === row.resolution,
      ) === index,
  )
  return (
    <div className="mt-3 space-y-2 text-[10px] leading-4 text-muted-foreground">
      <p className="font-medium text-foreground">Imagery metadata · LiDAR tile centre</p>
      {status && <p role="status">{status}</p>}
      {unique.map((row) => (
        <p key={`${row.source}-${row.date}-${row.resolution}`}>
          <span className="font-medium">{row.source}</span> · {row.date ?? 'date unknown'} ·{' '}
          {row.resolution === null ? 'resolution unknown' : `${row.resolution} m source resolution`}
        </p>
      ))}
      <p>
        LiDAR: 2024-07-13. Imagery varies by location and zoom; a mismatch can reflect acquisition date, alignment or
        detection error. Source resolution is not positional accuracy.
      </p>
      <a
        className="inline-block underline"
        href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9"
        target="_blank"
        rel="noopener noreferrer"
      >
        Imagery source & terms ↗
      </a>
    </div>
  )
}
