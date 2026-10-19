import { toMetric } from './sourceGrids'
import type { TreeCrop } from './treeIsolation'
import type { IsolatedPoint } from './treeIsolation'
import { TREE_COLOURS } from './treeIsolation'

export const MAX_PROFILE_PINS = 4
export const MAX_PINNED_RETURNS = 150000
export interface TreeProfile {
  crop: TreeCrop
  points: { east: number; north: number; height: number; original: IsolatedPoint }[]
  radius: number
  maximum: number
  minimum: number
}

/** Project original returns once; subsequent rotations stay in metric coordinates. */
export function prepareTreeProfile(crop: TreeCrop): TreeProfile {
  const [cx, cy] = toMetric(...crop.centre)
  const points: TreeProfile['points'] = []
  let radius = 1,
    maximum = 0,
    minimum = Infinity
  for (const p of crop.points) {
    if (![p.lon, p.lat, p.height].every(Number.isFinite) || p.height < 2 || p.height > 80) continue
    const [x, y] = toMetric(p.lon, p.lat)
    if (![x, y].every(Number.isFinite)) continue
    const east = x - cx,
      north = y - cy
    points.push({ east, north, height: p.height, original: p })
    radius = Math.max(radius, Math.hypot(east, north))
    maximum = Math.max(maximum, p.height)
    minimum = Math.min(minimum, p.height)
  }
  return { crop, points, radius, maximum, minimum }
}

export function profileHorizontal(east: number, north: number, angle: number) {
  const radians = (angle * Math.PI) / 180
  return east * Math.cos(radians) + north * Math.sin(radians)
}

/** Both axes and every candidate use exactly the same metres-to-pixels scale. */
export function profileScale(profiles: TreeProfile[]) {
  const height = Math.max(5, Math.ceil(Math.max(0, ...profiles.map((p) => p.maximum)) / 5) * 5)
  const halfWidth = Math.ceil(Math.max(1, ...profiles.map((p) => p.radius)) + 1)
  return { height, halfWidth, pixelsPerMetre: Math.min(190 / (halfWidth * 2), 280 / height) }
}

const xml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const number = (value: number) => value.toFixed(2)

/** Standalone scientific figure, also used by the interface; no invented stems or fills. */
export function treeProfilesSVG(profiles: TreeProfile[], angle: number, coloured = false, inspection?: unknown) {
  const view = inspection as
    | { settings?: { colour?: string; pointSize?: number }; assignments?: Record<string, string> }
    | undefined
  const strokeWidth = view?.settings?.pointSize ? Math.max(1, Math.min(12, view.settings.pointSize * 2)) : 1.3
  const colourFor = (key: string) =>
    key === 'black'
      ? '#111111'
      : key.startsWith('group:')
        ? key === 'group:0'
          ? '#a3a3a3'
          : TREE_COLOURS[[...key.slice(6)].reduce((n, c) => n + c.charCodeAt(0), 0) % TREE_COLOURS.length]
        : `hsl(${240 - ((Number(key) + 0.5) / 40) * 240},85%,38%)`
  const { height, halfWidth, pixelsPerMetre: scale } = profileScale(profiles)
  const width = Math.max(1, profiles.length) * 260,
    baseline = 340
  const metadata = JSON.stringify({
    method:
      'Orthographic projection of original EPT crown-column returns; per-return height above source 1 m DTM; 2–80 m crop; no inferred stems or branches',
    horizontal_axis_degrees_east_toward_north: angle,
    equal_metric_axes: true,
    inspection,
    crops: profiles.map((p) => ({ ...p.crop, points: undefined, plotted_returns: p.points.length })),
  })
  const cards = profiles
    .map((profile, index) => {
      const centre = index * 260 + 140
      const y = (h: number) => baseline - h * scale
      const paths = new Map<string, string[]>()
      let left = Infinity,
        right = -Infinity
      for (const p of profile.points) {
        const horizontal = profileHorizontal(p.east, p.north, angle)
        left = Math.min(left, horizontal)
        right = Math.max(right, horizontal)
        // A tiny round-ended stroke gives each observed return a visible point, with no connecting lines.
        const key =
          view?.settings?.colour === 'segment'
            ? `group:${view.assignments?.[`${p.original.node}:${p.original.index}`] ?? profile.crop.id}`
            : coloured
              ? String(Math.min(39, Math.floor(p.height)))
              : 'black'
        const group = paths.get(key) ?? []
        group.push(`M${number(centre + horizontal * scale)} ${number(y(p.height))}h0.01`)
        paths.set(key, group)
      }
      const span = profile.points.length ? right - left : 0
      const ticks: string[] = []
      const step = height > 30 ? 10 : 5
      for (let h = 0; h <= height; h += step)
        ticks.push(
          `<path d="M${centre - halfWidth * scale} ${y(h)}h${halfWidth * 2 * scale}" stroke="#e5e7eb"/><text x="${centre - halfWidth * scale - 5}" y="${y(h) + 4}" text-anchor="end">${h}</text>`,
        )
      if (height % step)
        ticks.push(
          `<text x="${centre - halfWidth * scale - 5}" y="${y(height) + 4}" text-anchor="end">${height}</text>`,
        )
      return `<g font-size="11" fill="#374151">
      <text x="${centre}" y="27" text-anchor="middle" font-size="14" font-weight="600">${xml(profile.crop.id)}</text>
      <text x="${centre}" y="44" text-anchor="middle">${profile.points.length.toLocaleString('en-US')} original returns</text>
      <rect x="${centre - halfWidth * scale}" y="${y(2)}" width="${halfWidth * 2 * scale}" height="${2 * scale}" fill="#fff1df"/>
      ${ticks.join('')}
      <text x="${centre - halfWidth * scale}" y="${y(height) - 8}">Height above terrain (m)</text>
      <path d="M${centre - halfWidth * scale} ${y(2)}h${halfWidth * 2 * scale}" stroke="#b45309" stroke-dasharray="3 3"/>
      ${[...paths].map(([key, values]) => `<path d="${values.join('')}" fill="none" stroke="${colourFor(key)}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`).join('')}
      <path d="M${centre - halfWidth * scale} ${baseline}h${halfWidth * 2 * scale}" stroke="#374151"/>
      ${[-halfWidth, 0, halfWidth].map((x) => `<text x="${centre + x * scale}" y="${baseline + 16}" text-anchor="middle">${x}</text>`).join('')}
      <text x="${centre}" y="${baseline + 33}" text-anchor="middle">Horizontal offset from treetop (m)</text>
      <text x="${centre}" y="${baseline + 51}" text-anchor="middle">${profile.points.length ? `Observed top ${number(profile.maximum)} m · span ${number(span)} m` : 'No eligible returns'}</text>
      <text x="${centre}" y="${baseline + 67}" text-anchor="middle">${profile.crop.budget_limited ? 'Partial crop · point budget limit' : `${profile.crop.loaded_nodes}/${profile.crop.available_nodes} selected nodes loaded`}</text>
    </g>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="510" viewBox="0 0 ${width} 510" role="img" aria-labelledby="profile-title profile-description">
    <title id="profile-title">Tree candidate side profiles · shared metre scale</title>
    <desc id="profile-description">${profiles.map((p) => xml(p.crop.id)).join(', ')}. Horizontal projection at ${angle} degrees east toward north. Actual returns; the crop excludes heights below 2 metres. No stem reconstruction.</desc>
    <metadata>${xml(metadata)}</metadata>
    <rect width="100%" height="100%" fill="white"/>
    <g font-family="Arial, sans-serif">${cards}
      <g font-size="11">
        <text x="12" y="432" fill="#92400e">0–2 m excluded by crop.</text>
        <text x="12" y="448" fill="#92400e">Missing points ≠ measured bare stem.</text>
        <text x="12" y="466" fill="#374151">Axis ${angle}° east toward north · equal metre axes.</text>
        <text x="12" y="482" fill="#374151">All depths projected · observed returns only.</text>
        ${coloured ? '<text x="12" y="498" fill="#374151">Height 0–40+ m: blue → cyan → green → red.</text>' : ''}
        ${view?.settings?.colour === 'segment' ? '<text x="12" y="498" fill="#374151">Colours distinguish manual candidate groups.</text>' : ''}
      </g>
    </g>
  </svg>`
}

export function canPinProfile(pinned: TreeProfile[], next: TreeProfile) {
  const others = pinned.filter((p) => p.crop.id !== next.crop.id)
  return (
    others.length < MAX_PROFILE_PINS &&
    pinned.every((p) => p.crop.source_sha256 === next.crop.source_sha256) &&
    others.reduce((sum, p) => sum + p.crop.points.length, next.crop.points.length) <= MAX_PINNED_RETURNS
  )
}
