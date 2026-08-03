import { useEffect, useState } from 'react'
import { IconLayer } from '@deck.gl/layers'
import { useMap } from '@/components/ui/map'
import { useDeckOverlay } from '@/components/ui/map-deck'
import type maplibregl from 'maplibre-gl'
import { windBarbIconForSpeed, type WindBarbIconKey } from '../lib/windBarbIcons'

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

type WindBarbDataset = {
  speedGrid: AsciiGrid
  directionGrid: AsciiGrid
}

type WindBarbDeckSample = WindBarbSample & {
  iconKey: WindBarbIconKey
  iconUrl: string
}

const EMPTY_WIND_BARB_DECK_SAMPLES: WindBarbDeckSample[] = []

const PG_WIND_BBOX = {
  west: -123.5,
  south: 53.2,
  east: -122.0,
  north: 54.4,
}

const WCS_BASE_URL = 'https://geo.weather.gc.ca/geomet'
const WIND_SPEED_COVERAGE = 'HRDPS-WEonG_2.5km_WindSpeed'
const WIND_DIR_COVERAGE = 'HRDPS-WEonG_2.5km_WindDir'
const WIND_BARB_PIXEL_SPACING = 22
const WIND_BARB_VIEW_PADDING = 48
const WIND_BARB_DECK_LAYER_ID = 'aqmap-vector-wind-barbs'

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

function gridsToDataset(speedGrid: AsciiGrid, directionGrid: AsciiGrid): WindBarbDataset {
  if (
    speedGrid.ncols !== directionGrid.ncols ||
    speedGrid.nrows !== directionGrid.nrows ||
    speedGrid.xllcorner !== directionGrid.xllcorner ||
    speedGrid.yllcorner !== directionGrid.yllcorner ||
    speedGrid.dx !== directionGrid.dx ||
    speedGrid.dy !== directionGrid.dy
  ) {
    throw new Error('Wind speed and direction WCS grids do not align.')
  }

  return { speedGrid, directionGrid }
}

function positiveModulo(value: number, modulus: number) {
  return ((value % modulus) + modulus) % modulus
}

function getFirstMonitorLayerId(map: maplibregl.Map): string | undefined {
  return map.getStyle().layers?.find((layer) => layer.id.startsWith('aqmap-monitor-'))?.id
}

function toDeckSample(sample: WindBarbSample): WindBarbDeckSample {
  const iconDefinition = windBarbIconForSpeed(sample.speed)

  return {
    ...sample,
    iconKey: iconDefinition.key,
    iconUrl: iconDefinition.src,
  }
}

function sampleDatasetAtLngLat(dataset: WindBarbDataset, lng: number, lat: number): WindBarbSample | null {
  const { speedGrid, directionGrid } = dataset
  const east = speedGrid.xllcorner + speedGrid.ncols * speedGrid.dx
  const north = speedGrid.yllcorner + speedGrid.nrows * speedGrid.dy

  if (lng < speedGrid.xllcorner || lng > east || lat < speedGrid.yllcorner || lat > north) return null

  const col = Math.max(0, Math.min(speedGrid.ncols - 1, Math.floor((lng - speedGrid.xllcorner) / speedGrid.dx)))
  const rowFromSouth = Math.max(0, Math.min(speedGrid.nrows - 1, Math.floor((lat - speedGrid.yllcorner) / speedGrid.dy)))
  const row = speedGrid.nrows - rowFromSouth - 1
  const speed = speedGrid.values[row]?.[col]
  const direction = directionGrid.values[row]?.[col]

  if (!Number.isFinite(speed) || !Number.isFinite(direction)) return null
  if (speedGrid.nodata !== null && speed === speedGrid.nodata) return null
  if (directionGrid.nodata !== null && direction === directionGrid.nodata) return null

  return {
    lng,
    lat,
    speed,
    direction,
    row,
    col,
  }
}

function firstLatticeCoordinate(anchor: number, min: number, spacing: number) {
  return min + positiveModulo(anchor - min, spacing)
}

function displayDeckSamplesForMap(map: maplibregl.Map, dataset: WindBarbDataset) {
  const canvas = map.getCanvas()
  const width = canvas.clientWidth
  const height = canvas.clientHeight
  const anchor = map.project([0, 0])
  const minX = -WIND_BARB_VIEW_PADDING
  const minY = -WIND_BARB_VIEW_PADDING
  const maxX = width + WIND_BARB_VIEW_PADDING
  const maxY = height + WIND_BARB_VIEW_PADDING
  const samples: WindBarbDeckSample[] = []

  for (let x = firstLatticeCoordinate(anchor.x, minX, WIND_BARB_PIXEL_SPACING); x <= maxX; x += WIND_BARB_PIXEL_SPACING) {
    for (let y = firstLatticeCoordinate(anchor.y, minY, WIND_BARB_PIXEL_SPACING); y <= maxY; y += WIND_BARB_PIXEL_SPACING) {
      const lngLat = map.unproject([x, y])
      const sample = sampleDatasetAtLngLat(dataset, lngLat.lng, lngLat.lat)
      if (!sample) continue
      samples.push(toDeckSample(sample))
    }
  }

  return samples
}

export function VectorWindBarbLayer({
  visible,
  basemap,
}: {
  visible: boolean
  basemap: 'light' | 'dark'
}) {
  const { map, isLoaded } = useMap()
  const overlayRef = useDeckOverlay({ enabled: visible })
  const [dataset, setDataset] = useState<WindBarbDataset | null>(null)
  const [visibleDeckSamples, setVisibleDeckSamples] = useState<WindBarbDeckSample[]>([])
  const [error, setError] = useState<string | null>(null)
  const canRenderSamples = visible && Boolean(map) && isLoaded && Boolean(dataset)
  const deckSamples = canRenderSamples ? visibleDeckSamples : EMPTY_WIND_BARB_DECK_SAMPLES

  useEffect(() => {
    if (!visible || dataset || error) return

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

      setDataset(gridsToDataset(parseAsciiGrid(speedText), parseAsciiGrid(directionText)))
    }

    loadSamples().catch((err) => {
      if ((err as Error).name === 'AbortError') return
      console.error('Vector wind barb layer failed', err)
      setError((err as Error).message)
    })

    return () => controller.abort()
  }, [dataset, error, visible])

  useEffect(() => {
    if (!visible || !map || !isLoaded || !dataset) return

    const mapInstance = map
    const windDataset = dataset
    let frameId: number | null = null

    function updateVisibleSamples() {
      setVisibleDeckSamples(displayDeckSamplesForMap(mapInstance, windDataset))
    }

    function scheduleUpdate() {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        updateVisibleSamples()
      })
    }

    updateVisibleSamples()
    mapInstance.on('move', scheduleUpdate)
    mapInstance.on('zoom', scheduleUpdate)
    mapInstance.on('moveend', scheduleUpdate)
    mapInstance.on('zoomend', scheduleUpdate)
    mapInstance.on('resize', scheduleUpdate)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      mapInstance.off('move', scheduleUpdate)
      mapInstance.off('zoom', scheduleUpdate)
      mapInstance.off('moveend', scheduleUpdate)
      mapInstance.off('zoomend', scheduleUpdate)
      mapInstance.off('resize', scheduleUpdate)
    }
  }, [dataset, isLoaded, map, visible])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay || !map) return

    overlay.setProps({
      layers: [
        new IconLayer<WindBarbDeckSample>({
          id: WIND_BARB_DECK_LAYER_ID,
          data: deckSamples,
          beforeId: getFirstMonitorLayerId(map),
          billboard: true,
          pickable: false,
          sizeUnits: 'pixels',
          getPosition: (sample: WindBarbDeckSample) => [sample.lng, sample.lat],
          getIcon: (sample: WindBarbDeckSample) => ({
            url: sample.iconUrl,
            width: 56,
            height: 28,
            anchorX: 28,
            anchorY: 14,
            mask: true,
          }),
          getSize: 17,
          getAngle: (sample: WindBarbDeckSample) => sample.direction - 90,
          getColor: basemap === 'light' ? [15, 23, 42, 175] : [255, 255, 255, 215],
          updateTriggers: {
            getColor: basemap,
          },
        } as unknown as ConstructorParameters<typeof IconLayer<WindBarbDeckSample>>[0]),
      ],
    })
  }, [overlayRef, basemap, deckSamples, map])

  return null
}
