import type { SightlineProfile } from './sightlineProfile'
export function SightlineProfileChart({ profile }: { profile: SightlineProfile }) {
  const all = profile.points
    .flatMap((p) => [p.ray, p.ground, p.canopy])
    .filter((n): n is number => n !== null && Number.isFinite(n))
  const low = Math.min(...all) - 2,
    high = Math.max(...all) + 2,
    span = high - low || 1
  const x = (d: number) => 40 + (500 * d) / Math.max(1, profile.distanceMeters),
    y = (h: number) => 170 - (140 * (h - low)) / span
  const path = (key: 'ray' | 'ground' | 'canopy') => {
    let previous = false
    return profile.points
      .map((p) => {
        const v = p[key]
        if (v === null) {
          previous = false
          return ''
        }
        const command = previous ? 'L' : 'M'
        previous = true
        return `${command}${x(p.distance).toFixed(2)},${y(v).toFixed(2)}`
      })
      .join(' ')
  }
  return (
    <div className="space-y-2 text-xs">
      <p>
        {profile.status} · {(profile.distanceMeters / 1000).toFixed(2)} km
        {profile.blockedAtMeters !== null ? ` · first obstruction at ${profile.blockedAtMeters.toFixed(0)} m` : ''}
      </p>
      <svg
        viewBox="0 0 560 205"
        role="img"
        aria-label="Sightline profile: elevation in metres by distance from the viewing station"
      >
        <path d={path('ground')} fill="none" stroke="#78716c" strokeWidth="2" />
        <path d={path('canopy')} fill="none" stroke="#15803d" strokeWidth="2" />
        <path d={path('ray')} fill="none" stroke="#dc2626" strokeWidth="2" />
        <text x="2" y="25" fontSize="10">
          {high.toFixed(0)} m
        </text>
        <text x="2" y="170" fontSize="10">
          {low.toFixed(0)} m
        </text>
        <text x="40" y="194" fontSize="10">
          0 m
        </text>
        <text x="450" y="194" fontSize="10">
          {profile.distanceMeters.toFixed(0)} m
        </text>
      </svg>
      <p>
        Brown: terrain. Green: screening surface. Red: sightline including curvature and configured clearance. Gaps
        indicate unknown cells. The profile uses the numerical sightline model’s sampling locations.
      </p>
    </div>
  )
}
