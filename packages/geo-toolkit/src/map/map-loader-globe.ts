export type GlobePalette = {
  bright: string
  dim: string
  rim: string
}

type GlobeContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

// Rough land-mass ellipses [centerLat, centerLon, latRadius, lonRadius] — enough
// silhouette for a thumbnail-sized globe without shipping real coastline data.
const LAND_MASSES = [
  [48, -100, 22, 33],
  [62, -98, 16, 42],
  [30, -98, 12, 16],
  [15, -88, 10, 9],
  [72, -40, 11, 17],
  [-8, -62, 18, 16],
  [-30, -65, 16, 9],
  [50, 14, 13, 22],
  [62, 18, 9, 12],
  [8, 18, 22, 20],
  [-18, 24, 16, 13],
  [50, 70, 24, 40],
  [60, 120, 20, 55],
  [25, 80, 13, 12],
  [30, 110, 14, 20],
  [5, 110, 11, 16],
  [-25, 134, 12, 19],
] as const

const LAND_CHARS = ['░', '▒', '▓', '█']
const OCEAN_CHARS = [' ', '·', '.', ':', '░']

function isLand(lat: number, lon: number) {
  if (lat < -62) return true
  return LAND_MASSES.some(([cLat, cLon, rLat, rLon]) => {
    const dl = Math.min(Math.abs(lon - cLon), 360 - Math.abs(lon - cLon))
    return ((lat - cLat) / rLat) ** 2 + (dl / rLon) ** 2 <= 1
  })
}

export function globePalette(isDark: boolean): GlobePalette {
  return isDark
    ? { bright: '#e9edea', dim: '#76817c', rim: '#4da3ff' }
    : { bright: '#334155', dim: '#94a3b8', rim: '#0284c7' }
}

export function drawAsciiGlobe(
  ctx: GlobeContext,
  width: number,
  height: number,
  rotation: number,
  exitProgress: number,
  palette: GlobePalette,
) {
  if (width === 0 || height === 0) return
  const radius = Math.min(width, height) * 0.46
  const fontSize = Math.max(6, Math.round((radius * 2) / 40))
  const xStep = fontSize * 0.6
  const yStep = fontSize * 1.02
  const cols = Math.ceil(width / xStep)
  const rows = Math.ceil(height / yStep)
  const cx = width / 2
  const cy = height / 2
  const tilt = (16 * Math.PI) / 180
  const cut = exitProgress * 2

  ctx.clearRect(0, 0, width, height)
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (let row = 0; row < rows; row++) {
    const py = row * yStep + yStep / 2
    const ny = (py - cy) / radius
    if (ny < -1.05 || ny > 1.05) continue
    for (let col = 0; col < cols; col++) {
      const px = col * xStep + xStep / 2
      const nx = (px - cx) / radius
      const r2 = nx * nx + ny * ny
      if (r2 > 1) continue
      const edge = Math.sqrt(r2)
      if (cut > 0 && edge < cut - 0.035) continue
      const z = Math.sqrt(1 - r2)
      const latY = -ny * Math.cos(tilt) + z * Math.sin(tilt)
      const depth = ny * Math.sin(tilt) + z * Math.cos(tilt)
      const rx = nx * Math.cos(rotation) - depth * Math.sin(rotation)
      const rz = nx * Math.sin(rotation) + depth * Math.cos(rotation)
      const lat = (Math.asin(Math.max(-1, Math.min(1, latY))) * 180) / Math.PI
      const lon = (Math.atan2(rx, rz) * 180) / Math.PI
      const light = Math.max(0, nx * -0.55 + -ny * 0.5 + z * 0.66) * 0.85 + 0.15
      if (light < 0.08) continue
      const chars = isLand(lat, lon) ? LAND_CHARS : OCEAN_CHARS
      const char = chars[Math.min(chars.length - 1, Math.floor(light * chars.length))]
      if (char === ' ') continue
      ctx.fillStyle = r2 > 0.9 && nx > 0 ? palette.rim : light > 0.62 ? palette.bright : palette.dim
      ctx.globalAlpha = r2 > 0.9 ? 0.86 : 1
      ctx.fillText(char, px, py)
    }
  }
  ctx.globalAlpha = 1
}
