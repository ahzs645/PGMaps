/**
 * A synthetic block, roads, streams and terrain for the block sheet tests and sample PDFs. Nothing
 * here is real data: the coordinates sit on an invented hillside near 54°N, 121.5°W.
 */
import type { SheetLayers } from './composeSheet'

const ORIGIN: [number, number] = [-121.53, 54.06]
const M_PER_DEG_LAT = 111_195
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN[1] * Math.PI) / 180)
const at = (east: number, north: number): [number, number] => [
  ORIGIN[0] + east / M_PER_DEG_LNG,
  ORIGIN[1] + north / M_PER_DEG_LAT,
]

/** A valley side falling to the north-east with gullies and a bench: enough relief for every slope class. */
export const syntheticTerrain = {
  elevationAt(lng: number, lat: number) {
    const x = (lng - ORIGIN[0]) * M_PER_DEG_LNG,
      y = (lat - ORIGIN[1]) * M_PER_DEG_LAT
    if (Math.abs(x) > 2600 || Math.abs(y) > 2200) return NaN
    const across = (x - y) / Math.SQRT2
    const along = (x + y) / Math.SQRT2
    const valley = 900 - 0.32 * along + 0.00009 * along * along
    const gullies = 22 * Math.sin(across / 140) * Math.exp(-((along + 400) ** 2) / 1.6e6)
    const bench = 30 / (1 + Math.exp(-(along - 300) / 40))
    const scarp = 60 / (1 + Math.exp(-(across + 900) / 25))
    const texture = 0.4 * Math.sin(x / 9) * Math.cos(y / 11)
    return valley + gullies + bench + scarp + texture
  },
}
export const syntheticCanopy = {
  elevationAt(lng: number, lat: number) {
    const x = (lng - ORIGIN[0]) * M_PER_DEG_LNG,
      y = (lat - ORIGIN[1]) * M_PER_DEG_LAT
    const stand = 24 + 9 * Math.sin(x / 180) * Math.cos(y / 210) + 5 * Math.sin(x / 23 + y / 31)
    return x > 600 && y < -300 ? 2 : Math.max(0, stand)
  },
}

const ring = [
  at(-700, 900),
  at(-450, 1050),
  at(-150, 600),
  at(250, 420),
  at(700, -150),
  at(820, -600),
  at(500, -720),
  at(-200, -300),
  at(-760, 280),
  at(-700, 900),
]
export const sampleLayers: SheetLayers = {
  block: { geometry: { type: 'Polygon', coordinates: [ring] }, name: 'BLK-001' },
  otherBlocks: [
    {
      geometry: {
        type: 'Polygon',
        coordinates: [[at(900, 500), at(1500, 700), at(1700, 100), at(1100, -100), at(900, 500)]],
      },
    },
  ],
  constraints: [
    {
      geometry: {
        type: 'Polygon',
        coordinates: [[at(-380, 180), at(-160, 260), at(-80, 60), at(-300, -20), at(-380, 180)]],
      },
    },
  ],
  streams: [
    { line: [at(-1800, 1500), at(-1300, 900), at(-900, 200), at(-400, -500), at(0, -1300), at(300, -2000)] },
    { line: [at(-300, 800), at(-500, 450), at(-900, 200)], ncd: true },
  ],
  existingRoads: [
    {
      line: [at(-2400, -1400), at(-1200, -1000), at(0, -900), at(1200, -1100), at(2400, -900)],
      forestService: true,
      name: 'Sample FSR',
    },
    { line: [at(1200, -1100), at(1500, -400), at(1350, 300)], forestService: false },
  ],
  roads: [
    {
      name: 'Spur A',
      color: '#2563eb',
      line: [at(0, -900), at(150, -650), at(300, -300), at(250, 100)],
      lengthM: 1080,
    },
    {
      name: 'Spur B',
      color: '#9333ea',
      line: [at(300, -300), at(550, -250), at(620, -480)],
      lengthM: 520,
    },
  ],
  notes: [
    {
      kind: 'line',
      points: [at(-500, 650), at(-350, 400), at(-150, 250)],
      color: '#fcf485',
      text: 'Proposed road: check grade',
      head: [at(-170, 290), at(-150, 250), at(-195, 265)],
    },
    {
      kind: 'area',
      points: [at(100, 100), at(350, 150), at(380, -50), at(120, -80)],
      color: '#dcaaff',
      text: 'Questionable volume. Recce before layout.',
    },
  ],
}
