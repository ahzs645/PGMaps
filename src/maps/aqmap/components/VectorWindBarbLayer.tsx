import { useEffect, useRef, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'

type AsciiGrid = {
  ncols: number
  nrows: number
  xllcorner: number
  yllcorner: number
  dx: number
  dy: number
  nodata: number | null
  values: number[][]
}

type WindBarbSample = {
  lng: number
  lat: number
  speed: number
  direction: number
  row: number
  col: number
}

const PG_WIND_BBOX = {
  west: -123.5,
  south: 53.2,
  east: -122.0,
  north: 54.4,
}

const WCS_BASE_URL = 'https://geo.weather.gc.ca/geomet'
const WIND_SPEED_COVERAGE = 'HRDPS-WEonG_2.5km_WindSpeed'
const WIND_DIR_COVERAGE = 'HRDPS-WEonG_2.5km_WindDir'

function buildWcsGridUrl(coverageId: string) {
  const params = new URLSearchParams({
    SERVICE: 'WCS',
    REQUEST: 'GetCoverage',
    VERSION: '2.0.1',
    COVERAGEID: coverageId,
    FORMAT: 'image/x-aaigrid',
  })

  params.append('SUBSET', `long(${PG_WIND_BBOX.west},${PG_WIND_BBOX.east})`)
  params.append('SUBSET', `lat(${PG_WIND_BBOX.south},${PG_WIND_BBOX.north})`)

  return `${WCS_BASE_URL}?${params.toString()}`
}

function extractAsciiGridPart(payload: string) {
  const start = payload.search(/\bncols\s+/i)
  if (start === -1) throw new Error('WCS response did not include an ASCII grid part.')

  const rest = payload.slice(start)
  const nextBoundary = rest.search(/\r?\n--wcs\b/i)

  return (nextBoundary === -1 ? rest : rest.slice(0, nextBoundary)).trim()
}

function parseAsciiGrid(payload: string): AsciiGrid {
  const gridText = extractAsciiGridPart(payload)
  const lines = gridText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const header = new Map<string, number>()
  let dataStartIndex = 0

  for (const [index, line] of lines.entries()) {
    const [rawKey, rawValue] = line.split(/\s+/, 2)
    const key = rawKey.toLowerCase()
    const value = Number(rawValue)

    if (!Number.isFinite(value) || !['ncols', 'nrows', 'xllcorner', 'yllcorner', 'dx', 'dy', 'cellsize', 'nodata_value'].includes(key)) {
      dataStartIndex = index
      break
    }

    header.set(key, value)
  }

  const ncols = header.get('ncols')
  const nrows = header.get('nrows')
  const xllcorner = header.get('xllcorner')
  const yllcorner = header.get('yllcorner')
  const dx = header.get('dx') ?? header.get('cellsize')
  const dy = header.get('dy') ?? header.get('cellsize')

  if (
    ncols === undefined ||
    nrows === undefined ||
    xllcorner === undefined ||
    yllcorner === undefined ||
    dx === undefined ||
    dy === undefined
  ) {
    throw new Error('WCS ASCII grid header is missing required fields.')
  }

  const rows = lines.slice(dataStartIndex).map((line) => line.split(/\s+/).map(Number))

  if (rows.length < nrows || rows.some((row) => row.length < ncols)) {
    throw new Error('WCS ASCII grid body is incomplete.')
  }

  return {
    ncols,
    nrows,
    xllcorner,
    yllcorner,
    dx,
    dy,
    nodata: header.get('nodata_value') ?? null,
    values: rows.slice(0, nrows).map((row) => row.slice(0, ncols)),
  }
}

function gridsToSamples(speedGrid: AsciiGrid, directionGrid: AsciiGrid): WindBarbSample[] {
  const samples: WindBarbSample[] = []

  for (let row = 0; row < speedGrid.nrows; row += 1) {
    for (let col = 0; col < speedGrid.ncols; col += 1) {
      const speed = speedGrid.values[row]?.[col]
      const direction = directionGrid.values[row]?.[col]
      if (!Number.isFinite(speed) || !Number.isFinite(direction)) continue
      if (speedGrid.nodata !== null && speed === speedGrid.nodata) continue
      if (directionGrid.nodata !== null && direction === directionGrid.nodata) continue

      samples.push({
        lng: speedGrid.xllcorner + (col + 0.5) * speedGrid.dx,
        lat: speedGrid.yllcorner + (speedGrid.nrows - row - 0.5) * speedGrid.dy,
        speed,
        direction,
        row,
        col,
      })
    }
  }

  return samples
}

function sampleStrideForZoom(zoom: number) {
  if (zoom < 6) return null
  if (zoom < 7) return 12
  if (zoom < 8) return 8
  if (zoom < 9) return 5
  if (zoom < 10.5) return 2
  return 1
}

function drawWindBarb(context: CanvasRenderingContext2D, x: number, y: number, speedMetersPerSecond: number, directionDegrees: number) {
  const speedKnots = speedMetersPerSecond * 1.94384
  const roundedSpeed = Math.max(5, Math.round(speedKnots / 5) * 5)
  let remaining = roundedSpeed

  const shaftLength = 22
  const barbLength = 7
  const barbSpacing = 4.5
  const angle = ((directionDegrees - 90) * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  function pointAlong(distance: number) {
    return {
      x: x + cos * distance,
      y: y + sin * distance,
    }
  }

  function rotateOffset(baseX: number, baseY: number, forward: number, side: number) {
    return {
      x: baseX + cos * forward - sin * side,
      y: baseY + sin * forward + cos * side,
    }
  }

  context.beginPath()
  context.moveTo(x, y)
  const tip = pointAlong(shaftLength)
  context.lineTo(tip.x, tip.y)

  let cursor = shaftLength
  while (remaining >= 50) {
    const base = pointAlong(cursor)
    const next = pointAlong(cursor - barbSpacing)
    const outer = rotateOffset(base.x, base.y, -barbSpacing * 0.4, barbLength)
    context.moveTo(base.x, base.y)
    context.lineTo(outer.x, outer.y)
    context.lineTo(next.x, next.y)
    remaining -= 50
    cursor -= barbSpacing + 2
  }

  while (remaining >= 10) {
    const base = pointAlong(cursor)
    const outer = rotateOffset(base.x, base.y, -barbSpacing * 0.35, barbLength)
    context.moveTo(base.x, base.y)
    context.lineTo(outer.x, outer.y)
    remaining -= 10
    cursor -= barbSpacing
  }

  if (remaining >= 5) {
    const base = pointAlong(cursor)
    const outer = rotateOffset(base.x, base.y, -barbSpacing * 0.2, barbLength * 0.55)
    context.moveTo(base.x, base.y)
    context.lineTo(outer.x, outer.y)
  }

  context.stroke()
}

export function VectorWindBarbLayer({
  visible,
  basemap,
}: {
  visible: boolean
  basemap: 'light' | 'dark'
}) {
  const { map, isLoaded } = useMap()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [samples, setSamples] = useState<WindBarbSample[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!visible || samples || error) return

    const controller = new AbortController()

    async function loadSamples() {
      const [speedResponse, directionResponse] = await Promise.all([
        fetch(buildWcsGridUrl(WIND_SPEED_COVERAGE), { signal: controller.signal }),
        fetch(buildWcsGridUrl(WIND_DIR_COVERAGE), { signal: controller.signal }),
      ])

      if (!speedResponse.ok) throw new Error(`Wind speed WCS request failed: ${speedResponse.status}`)
      if (!directionResponse.ok) throw new Error(`Wind direction WCS request failed: ${directionResponse.status}`)

      const [speedText, directionText] = await Promise.all([
        speedResponse.text(),
        directionResponse.text(),
      ])

      setSamples(gridsToSamples(parseAsciiGrid(speedText), parseAsciiGrid(directionText)))
    }

    loadSamples().catch((err) => {
      if ((err as Error).name === 'AbortError') return
      console.error('Vector wind barb layer failed', err)
      setError((err as Error).message)
    })

    return () => controller.abort()
  }, [error, samples, visible])

  useEffect(() => {
    if (!visible || !map || !isLoaded || !canvasRef.current || !samples) return

    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    if (!context) return
    const canvasContext: CanvasRenderingContext2D = context
    const windSamples = samples

    const mapInstance = map
    let width = 0
    let height = 0

    function render() {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      const nextWidth = Math.max(1, Math.floor(rect.width * pixelRatio))
      const nextHeight = Math.max(1, Math.floor(rect.height * pixelRatio))

      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth
        canvas.height = nextHeight
        width = rect.width
        height = rect.height
      } else {
        width = rect.width
        height = rect.height
      }

      canvasContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
      canvasContext.clearRect(0, 0, width, height)
      canvasContext.lineWidth = basemap === 'light' ? 1.05 : 1
      canvasContext.strokeStyle = basemap === 'light' ? 'rgba(15, 23, 42, 0.62)' : 'rgba(255, 255, 255, 0.76)'
      canvasContext.lineCap = 'round'
      canvasContext.lineJoin = 'round'

      const sampleStride = sampleStrideForZoom(mapInstance.getZoom())
      if (sampleStride === null) return

      for (const sample of windSamples) {
        if (sample.row % sampleStride !== 0 || sample.col % sampleStride !== 0) continue
        const point = mapInstance.project([sample.lng, sample.lat])
        if (point.x < -40 || point.y < -40 || point.x > width + 40 || point.y > height + 40) continue
        drawWindBarb(canvasContext, point.x, point.y, sample.speed, sample.direction)
      }
    }

    render()
    mapInstance.on('render', render)
    mapInstance.on('resize', render)

    return () => {
      mapInstance.off('render', render)
      mapInstance.off('resize', render)
    }
  }, [basemap, isLoaded, map, samples, visible])

  if (!visible) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-0 z-[3] h-full w-full',
        basemap === 'dark' && 'mix-blend-screen',
      )}
    />
  )
}
