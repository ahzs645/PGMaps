/**
 * Geometric reconstructions of the motifs on Rainforest to Rockies, page 8.
 *
 * These are newly drawn components, not extracted or traced contours. Dimensions
 * and placements are measurements of the supplied raster; the geometry below is
 * authored from semantic parts (wheels, limbs, branches, bowls and peak vertices).
 * Coordinates are local to each symbol. All output is editable, image-free SVG.
 */
export type ElementCategory = 'illustration' | 'navigation' | 'tree' | 'drafting'

export interface ElementDef {
  id: string
  title: string
  category: ElementCategory
  width: number
  height: number
  svg: string
  construction: string
  sourceBox?: [number, number, number, number]
}

const EMERALD = '#1A7667'
const CANOPY = '#00392F'
const MOSS = '#B0BD36'
const WHITE = '#FFFFFF'
const PIN = '#AC4B3F'

const n = (value: number) => Number(value.toFixed(3))
const path = (d: string, fill = 'none', stroke = EMERALD, width = 3) =>
  `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`
const circle = (x: number, y: number, radius: number, fill: string) =>
  `<circle cx="${x}" cy="${y}" r="${radius}" fill="${fill}"/>`
const ellipse = (x: number, y: number, rx: number, ry: number, fill: string, angle = 0) =>
  `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${fill}" transform="rotate(${angle} ${x} ${y})"/>`
const group = (svg: string, transform: string) => `<g transform="${transform}">${svg}</g>`
const scaleDrawing = (svg: string, fromWidth: number, fromHeight: number, width: number, height: number) =>
  group(svg, `scale(${n(width / fromWidth)} ${n(height / fromHeight)})`)
/** A small monoline lettering alphabet, built as strokes rather than font traces. */
const BADGE_GLYPHS: Readonly<Record<string, { advance: number; d: string }>> = {
  '1': { advance: 12, d: 'M 2,6 L 7,2 L 7,22 M 2,22 L 12,22' },
  '3': { advance: 16, d: 'M 2,4 Q 8,-1 13,4 Q 17,10 8,12 Q 17,12 13,20 Q 8,26 2,20' },
  '5': { advance: 16, d: 'M 14,2 L 3,2 L 2,11 Q 7,8 11,10 Q 17,14 12,20 Q 8,25 2,20' },
  '9': { advance: 16, d: 'M 14,10 Q 12,15 5,12 Q -1,9 3,4 Q 7,-1 12,3 Q 18,9 12,17 L 6,22' },
  '0': { advance: 16, d: 'M 8,2 C -1,2 -1,22 8,22 C 17,22 17,2 8,2 Z' },
  B: { advance: 16, d: 'M 2,2 L 2,22 L 8,22 Q 15,22 14,17 Q 14,12 7,12 L 2,12 M 7,12 Q 15,12 13,6 Q 13,2 8,2 L 2,2' },
  C: { advance: 16, d: 'M 14,4 Q 2,-2 2,12 Q 2,26 14,20' },
  N: { advance: 16, d: 'M 2,22 L 2,2 L 14,22 L 14,2' },
  E: { advance: 16, d: 'M 14,2 L 2,2 L 2,22 L 14,22 M 2,12 L 12,12' },
  S: { advance: 16, d: 'M 14,4 Q 9,-1 4,3 Q -1,9 8,12 Q 17,15 12,21 Q 7,25 2,20' },
  W: { advance: 18, d: 'M 1,2 L 4,22 L 9,10 L 14,22 L 17,2' },
}

function badgeLettering(text: string, x: number, baseline: number, size: number, colour = WHITE): string {
  const glyphs = [...text].map((letter) => {
    const glyph = BADGE_GLYPHS[letter]
    if (!glyph) throw new Error(`No constructed badge glyph for ${letter}`)
    return glyph
  })
  const scale = size / 28
  const gap = 2
  const width = glyphs.reduce((sum, glyph) => sum + glyph.advance, 0) + gap * (glyphs.length - 1)
  let cursor = 0
  const svg = glyphs
    .map((glyph) => {
      const drawing = group(path(glyph.d, 'none', colour, size < 20 ? 2.5 : 3.1), `translate(${cursor} 0)`)
      cursor += glyph.advance + gap
      return drawing
    })
    .join('')
  return group(svg, `translate(${n(x - (width * scale) / 2)} ${n(baseline - 23 * scale)}) scale(${n(scale)})`)
}

function definition(
  id: string,
  title: string,
  category: ElementCategory,
  width: number,
  height: number,
  svg: string,
  construction: string,
  sourceBox?: [number, number, number, number],
): ElementDef {
  return { id, title, category, width, height, svg, construction, ...(sourceBox ? { sourceBox } : {}) }
}

/** A trunk and paired branch tiers; phase changes the lean, not the topology. */
export function evergreenMarkup(width: number, height: number, phase = 0, tiers = 3): string {
  const lean = Math.sin(phase * 1.7) * 4
  let svg = path(
    `M ${46 + lean},15 Q ${45 + lean / 2},52 46,89 Q 47,96 52,96 Q 57,95 56,88 L ${55 + lean},15 Z`,
    EMERALD,
    'none',
    0,
  )
  for (let tier = 0; tier < tiers; tier++) {
    const y = 15 + (tier * 59) / Math.max(1, tiers - 1)
    const spread = 28 + tier * (12 / Math.max(1, tiers - 1))
    const center = 50 + lean * (1 - y / 100)
    const rise = 14 + Math.sin(phase + tier) * 2
    const drift = Math.sin(phase * 2 + tier) * 3
    svg += path(
      `M ${n(center)},${n(y - 5)} Q ${n(center - spread / 2)},${n(y)} ${n(center - spread)},${n(y + rise - 3)} Q ${n(center - spread - 4)},${n(y + rise + 5)} ${n(center - spread + 3)},${n(y + rise + 6)} Q ${n(center - 9)},${n(y + 12)} ${n(center)},${n(y + 6)} Q ${n(center + 9)},${n(y + 12 + drift)} ${n(center + spread - 3)},${n(y + rise + drift + 6)} Q ${n(center + spread + 4)},${n(y + rise + drift + 5)} ${n(center + spread)},${n(y + rise + drift - 3)} Q ${n(center + spread / 2)},${n(y + drift)} ${n(center)},${n(y - 5)} Z`,
      EMERALD,
      'none',
      0,
    )
  }
  return scaleDrawing(svg, 100, 100, width, height)
}

/** Three overlapping conifer tiers and a short trunk, deliberately asymmetric. */
export function mossTreeMarkup(width: number, height: number, phase = 0, colour = MOSS, halo = false): string {
  const lean = Math.sin(phase) * 4
  const d = `M ${50 + lean},7 Q ${44 + lean},9 30,33 L 36,35 L 23,54 Q 22,58 33,58 L 15,78 Q 19,82 42,81 L 42,94 L 57,94 L 58,81 Q 78,84 86,79 L 68,57 Q 79,58 77,54 L 63,34 L 68,32 Q 58,12 ${50 + lean},7 Z`
  const svg = (halo ? path(d, colour, WHITE, 11) : '') + path(d, colour, colour, 1.5)
  return scaleDrawing(svg, 100, 100, width, height)
}

function wave(width: number, height: number, crests: number, phase = 0): string {
  const left = 3
  const span = width - 6
  const trough = height * 0.45
  let d = `M ${left},${n(trough)}`
  for (let i = 0; i < crests; i++) {
    const x = left + (i * span) / crests
    const next = left + ((i + 1) * span) / crests
    const crestX = x + (next - x) * 0.62
    const top = height * (0.16 + 0.035 * Math.sin(i + phase))
    d += ` Q ${n(x + (next - x) * 0.3)},${n(trough + 2)} ${n(crestX - (next - x) * 0.05)},${n(top + height * 0.07)} Q ${n(crestX)},${n(top - height * 0.02)} ${n(crestX + (next - x) * 0.05)},${n(top + height * 0.08)} Q ${n(crestX + (next - x) * 0.16)},${n(trough + 2)} ${n(next)},${n(trough)}`
  }
  d += ` Q ${width - 2},${n(height * 0.94)} ${n(width - span * 0.17)},${n(height * 0.88)}`
  for (let i = crests - 1; i > 0; i--) {
    const x = left + (i * span) / crests
    d += ` Q ${n(x + (span / crests) * 0.18)},${n(height * 0.8)} ${n(x)},${n(height * 0.69)} Q ${n(x - (span / crests) * 0.28)},${n(height * 0.92)} ${n(x - (span / crests) * 0.53)},${n(height * 0.86)}`
  }
  d += ` Q 1,${n(height * 0.83)} ${left},${n(trough)} Z`
  return path(d, WHITE, 'none', 0)
}

function ripples(width: number, height: number): string {
  const row = (x: number, y: number, peaks: number, step: number) => {
    let d = `M ${x},${y + 5}`
    for (let i = 0; i < peaks; i++) {
      const crestX = x + step * (i + 0.47)
      const crestY = y + Math.sin(i * 2 + y) * 0.9
      const endX = x + step * (i + 1)
      const endY = y + 5 + Math.cos(i + x) * 0.6
      d += ` L ${n(crestX - 1.2)},${n(crestY + 1.1)} Q ${n(crestX)},${n(crestY - 0.5)} ${n(crestX + 1.5)},${n(crestY + 1.2)} L ${n(endX)},${n(endY)}`
    }
    return path(d, 'none', EMERALD, 3.3)
  }
  return scaleDrawing(row(10, 4, 2, 13) + row(4, 16, 4, 11) + row(30, 28, 2, 8), 52, 39, width, height)
}

const bear = path(
  'M 5,34 C 9,26 11,16 17,9 Q 23,4 32,7 Q 39,9 44,7 Q 49,7 52,11 L 59,12 L 64,22 Q 64,25 58,24 L 51,24 Q 49,28 54,33 Q 56,36 54,39 L 49,39 L 44,31 L 43,40 L 38,39 L 36,29 L 32,32 L 32,40 Q 27,42 24,39 L 22,29 Q 16,28 13,39 L 7,40 Q 3,39 5,34 Z',
  WHITE,
  EMERALD,
  3.3,
)
const birds = path(
  'M 5,10 L 17,16 L 12,4 M 17,16 Q 27,8 33,6 M 32,18 L 43,24 L 39,12 M 43,24 Q 49,17 54,16',
  'none',
  MOSS,
  2.5,
)
const cyclist =
  path(
    'M 8,55 Q 9,43 21,42 Q 34,42 35,55 Q 35,69 22,69 Q 9,69 8,55 Z M 55,42 Q 55,29 68,29 Q 81,29 81,43 Q 81,56 68,57 Q 55,56 55,42 Z',
    'none',
    MOSS,
    4,
  ) +
  path('M 66,42 L 56,19 L 49,18 M 55,23 L 43,41 L 29,43 M 44,41 L 54,43', 'none', MOSS, 3) +
  circle(43, 9, 6.5, EMERALD) +
  path('M 36,20 Q 32,21 30,31 L 27,40 L 42,46 L 50,60', 'none', EMERALD, 9) +
  path('M 36,23 L 43,30 L 50,33', 'none', EMERALD, 4.5) +
  path('M 5,61 L 2,59 M 7,68 L 3,68', 'none', EMERALD, 2.2)
const fishingBoat =
  path('M 5,28 L 60,28 Q 64,29 64,36 L 64,43 Q 52,43 45,44 Q 35,42 28,44 Q 13,46 5,34 Z', WHITE, MOSS, 3.5) +
  path('M 64,31 L 70,31 L 71,41 L 66,41 M 75,43 L 73,5 L 58,14', 'none', MOSS, 2.5) +
  circle(46, 7, 4.5, EMERALD) +
  path('M 44,15 Q 40,18 40,26 L 48,26 L 48,21 L 57,19 L 58,16 Z', EMERALD, 'none', 0)
const gondola =
  path('M 18,4 L 32,4 M 25,5 L 17,22 M 27,5 L 34,22 M 20,12 L 29,12', 'none', EMERALD, 2.8) +
  path('M 6,23 Q 4,23 4,31 L 4,43 Q 4,48 10,48 L 41,48 Q 47,48 47,43 L 46,30 Q 45,23 39,23 Z', WHITE, EMERALD, 4.1) +
  path('M 6,39 L 45,39 L 45,44 Q 45,47 40,47 L 10,47 Q 6,47 6,43 Z', EMERALD, 'none', 0) +
  path('M 15,24 L 15,39 M 32,24 L 32,39', 'none', EMERALD, 2.8) +
  circle(12, 43, 1.8, WHITE) +
  circle(25, 43, 1.8, WHITE) +
  circle(39, 43, 1.8, WHITE)
const hiker =
  circle(18, 8, 6.5, EMERALD) +
  path('M 15,19 Q 23,17 25,24 L 24,69 Q 22,73 17,72 L 13,30 Z', EMERALD, 'none', 0) +
  path('M 23,23 L 33,33 L 37,34', 'none', EMERALD, 4.8) +
  path('M 35,24 L 35,71', 'none', MOSS, 3) +
  path('M 4,22 Q 6,19 10,21 L 11,45 Q 8,48 5,46 Z', MOSS, MOSS, 1) +
  circle(7, 23, 1.6, WHITE)
function hotSprings(): string {
  let svg = ''
  const stones: [number, number, number, number, number][] = [
    [10, 29, 9, 4, -2],
    [23, 18, 8, 4, -10],
    [43, 15, 8, 4, 4],
    [80, 18, 9, 4, 7],
    [96, 28, 9, 4, 2],
    [89, 40, 9, 5, -5],
    [69, 48, 11, 5, 0],
    [46, 49, 11, 5, 4],
    [25, 43, 11, 5, 8],
  ]
  stones.forEach(([x, y, rx, ry, angle]) => {
    svg += ellipse(x, y, rx, ry, MOSS, angle)
  })
  svg += circle(54, 14, 5.5, EMERALD)
  svg += path('M 44,34 L 44,27 Q 44,22 53,22 Q 63,22 63,28 L 63,35 Z', EMERALD, 'none', 0)
  svg += path(
    'M 33,7 Q 28,13 33,18 Q 37,22 33,28 M 70,3 Q 74,9 70,15 M 80,9 Q 74,14 79,20 Q 83,25 79,30',
    'none',
    EMERALD,
    2.7,
  )
  return svg
}
const orca =
  path(
    'M 4,35 Q 7,24 17,17 Q 21,13 18,7 L 16,3 Q 22,3 27,9 Q 36,6 45,7 Q 54,8 59,14 Q 56,18 46,22 L 42,30 Q 40,33 36,30 L 37,26 Q 31,30 26,31 L 13,37 Q 5,42 4,35 Z',
    EMERALD,
    'none',
    0,
  ) +
  path(
    'M 43,11 Q 46,8 50,10 Q 51,11 49,12 L 43,13 Z M 43,16 Q 49,12 55,15 Q 50,18 44,20 Z M 10,32 Q 11,25 16,26 L 21,29 L 16,28 L 12,35 Z',
    WHITE,
    'none',
    0,
  ) +
  path('M 17,34 Q 22,33 32,28', 'none', WHITE, 1.6)
const waterfall =
  path('M 25,61 L 25,10 Q 25,4 31,8 Q 34,2 39,7 Q 42,2 47,7 Q 52,3 56,7 Q 59,3 63,7 L 64,62', WHITE, EMERALD, 2.7) +
  path(
    'M 34,10 L 34,24 M 33,30 L 34,51 M 42,12 L 43,43 M 42,51 L 43,64 M 52,13 L 51,24 M 52,30 L 52,54 M 59,11 L 59,32',
    'none',
    EMERALD,
    2.6,
  ) +
  path(
    'M 29,13 L 29,23 M 29,31 L 30,39 M 30,47 L 30,55 M 47,17 L 47,28 M 47,35 L 48,46 M 48,55 L 48,61 M 58,39 L 58,49 M 59,54 L 59,60',
    'none',
    EMERALD,
    1.6,
  ) +
  path('M 16,73 Q 17,60 28,60 Q 37,59 43,66 Q 49,75 56,65 Q 68,59 74,72 L 75,75', WHITE, EMERALD, 3) +
  path('M 12,59 L 8,54 M 14,64 L 9,62 M 72,60 L 77,55 M 74,65 L 79,63', 'none', EMERALD, 2) +
  path('M 5,76 Q 29,74 41,76 Q 59,74 85,76', 'none', MOSS, 4.5)
const mountains =
  path(
    'M 54,65 L 88,10 L 106,36 L 120,22 L 148,49 Q 153,41 160,49 L 170,23 L 175,29 L 186,12 Q 188,9 190,14 L 199,39 L 203,34 L 217,61 Q 221,68 214,69 Z',
    EMERALD,
    EMERALD,
    2,
  ) +
  path(
    'M 18,48 L 32,22 L 39,32 L 50,6 L 67,51 Z M 42,66 L 53,43 L 66,66 Z M 65,48 L 72,36 L 81,50 Z',
    WHITE,
    EMERALD,
    5,
  ) +
  path('M 72,69 L 88,27 L 126,70 Q 133,80 126,84 L 95,91', WHITE, EMERALD, 6) +
  group(mossTreeMarkup(38, 49, 0.8, EMERALD, true), 'translate(23 42)') +
  group(mossTreeMarkup(44, 56, 0.5, MOSS, true), 'translate(0 43)') +
  group(mossTreeMarkup(39, 49, 1.1, MOSS, true), 'translate(129 43)') +
  group(mossTreeMarkup(33, 42, 2.2, MOSS, true), 'translate(175 52)') +
  group(mossTreeMarkup(49, 58, 1.7, EMERALD, true), 'translate(145 46)')
function wineGlasses(): string {
  const glass = (angle: number, x: number, y: number) => {
    const bowl = path('M 6,3 L 30,3 Q 38,22 31,31 Q 25,38 18,38 Q 9,38 3,31 Q -3,22 6,3 Z', WHITE, EMERALD, 2.4)
    const wine = path('M 2,21 Q 18,23 34,20 Q 35,35 18,35 Q 4,34 2,21 Z', MOSS, 'none', 0)
    const stem = path('M 18,38 L 18,59 M 5,60 L 32,60', 'none', EMERALD, 4)
    return group(bowl + wine + stem, `translate(${x} ${y}) rotate(${angle} 18 38)`)
  }
  return glass(16, 8, 10) + glass(-30, 51, 4)
}
const grove =
  group(evergreenMarkup(22, 33, 0.2), 'translate(30 2)') +
  group(evergreenMarkup(28, 43, 1.3), 'translate(55 2)') +
  group(evergreenMarkup(37, 55, 0.7), 'translate(4 29)') +
  group(evergreenMarkup(37, 58, 1.8), 'translate(41 43)') +
  group(evergreenMarkup(32, 52, 2.4), 'translate(73 28)')

const illustrations: ElementDef[] = [
  definition(
    'bear',
    'Bear',
    'illustration',
    68,
    45,
    bear,
    'Anatomical landmarks, four leg cutouts and one continuous cubic outline.',
    [387, 513, 68, 45],
  ),
  definition(
    'birds',
    'Two flying birds',
    'illustration',
    56,
    28,
    birds,
    'Two pairs of curved wing strokes with distinct lean.',
    [751, 368, 56, 28],
  ),
  definition(
    'cyclist',
    'Cyclist',
    'illustration',
    86,
    72,
    cyclist,
    'Two wheel rings, fork, frame, articulated rider and oval head.',
    [931, 649, 86, 72],
  ),
  definition(
    'fishing-boat',
    'Fishing boat',
    'illustration',
    77,
    51,
    fishingBoat,
    'Bezier hull, seated figure, fishing rod and line.',
    [524, 397, 77, 51],
  ),
  definition(
    'gondola',
    'Gondola cabin',
    'illustration',
    50,
    52,
    gondola,
    'Rounded cabin, divided windows, sill lights and suspension triangle.',
    [469, 585, 50, 52],
  ),
  definition(
    'grove',
    'Five-tree grove',
    'illustration',
    107,
    102,
    grove,
    'Five instances of the shared trunk-and-branch grammar.',
    [435, 667, 107, 102],
  ),
  definition(
    'hiker',
    'Hiker',
    'illustration',
    40,
    75,
    hiker,
    'Head, tapered torso and legs, bent arm, backpack and pole.',
    [972, 287, 40, 75],
  ),
  definition(
    'hot-springs',
    'Hot springs',
    'illustration',
    108,
    57,
    hotSprings(),
    'Elliptical stone ring, bather and three steam curves.',
    [1063, 578, 108, 57],
  ),
  definition(
    'mountain-range',
    'Rockies mountain range',
    'illustration',
    221,
    105,
    mountains,
    'Composed peak vertices, snow faces, foreground trail and reusable trees.',
    [1036, 433, 221, 105],
  ),
  definition(
    'orca',
    'Orca',
    'illustration',
    61,
    41,
    orca,
    'Back, dorsal fin, nose, belly and flipper landmarks with white patches.',
    [355, 812, 61, 41],
  ),
  definition(
    'water-ripples-north',
    'Water ripples — north',
    'illustration',
    49,
    39,
    ripples(49, 39),
    'Three rows of rounded chevrons: two, four and two crests.',
    [618, 386, 49, 39],
  ),
  definition(
    'water-ripples-south',
    'Water ripples — south',
    'illustration',
    38,
    30,
    ripples(38, 30),
    'Smaller instance of the shared three-row ripple grammar.',
    [535, 644, 38, 30],
  ),
  definition(
    'waterfall',
    'Waterfall',
    'illustration',
    90,
    80,
    waterfall,
    'Rock lip, independent falling streams, spray strokes and pool arcs.',
    [684, 240, 90, 80],
  ),
  definition(
    'wave-coast-east',
    'Coastal wave — east',
    'illustration',
    54,
    23,
    wave(54, 23, 2, 0.4),
    'Two crest arcs and a shallow white return curve.',
    [401, 860, 54, 23],
  ),
  definition(
    'wave-coast-north',
    'Coastal wave — north',
    'illustration',
    59,
    25,
    wave(59, 25, 2, 1.1),
    'Two unequal crest arcs and a shallow white return curve.',
    [97, 534, 59, 25],
  ),
  definition(
    'wave-coast-orca',
    'Coastal wave — orca',
    'illustration',
    79,
    19,
    wave(79, 19, 3, 0.7),
    'Three low crest arcs on a shared white ribbon.',
    [327, 842, 79, 19],
  ),
  definition(
    'wave-coast-west',
    'Coastal wave — west',
    'illustration',
    100,
    22,
    wave(100, 22, 3, 2),
    'Three broad crest arcs on a shared white ribbon.',
    [34, 868, 100, 22],
  ),
  definition(
    'wine-glasses',
    'Wine glasses',
    'illustration',
    97,
    76,
    wineGlasses(),
    'Two rotated bowl, wine, stem and foot assemblies.',
    [857, 551, 97, 76],
  ),
]

function shield(number = ''): string {
  return (
    path('M 26.5,4 L 47,13 Q 48,33 26.5,45 Q 6,34 6,13 Z', CANOPY, WHITE, 3.5) +
    (number ? badgeLettering(number, 26.5, 33, number.length > 1 ? 23 : 27) : '')
  )
}
function leaf(number = '', fill = CANOPY): string {
  return (
    path(
      'M 29,4 Q 23,5 19,12 L 20,24 Q 11,17 6,23 Q 0,31 8,38 L 19,44 L 15,50 L 27,47 L 28,58 L 31,58 L 32,47 L 44,50 L 40,44 Q 54,39 54,29 Q 53,18 43,21 L 36,25 L 37,14 Q 35,7 29,4 Z',
      fill,
      WHITE,
      3,
    ) + (number ? badgeLettering(number, 29, 42, 32) : '')
  )
}
function flag(width = 68, height = 95, lean = 0): string {
  const svg =
    circle(18, 82, 12, MOSS) +
    path(`M 19,83 Q ${20 + lean},43 ${21 + lean},8`, 'none', EMERALD, 7) +
    path(`M ${22 + lean},13 Q 38,13 48,16 L 48,27 L 64,27 L 61,70 Q 46,72 29,70 L 27,62 L 20,62 Z`, EMERALD, 'none', 0)
  return scaleDrawing(svg, 68, 95, width, height)
}
const pin =
  path('M 21,4 C 10,4 4,12 4,22 Q 4,33 21,47 Q 38,32 38,21 C 38,12 31,4 21,4 Z', PIN, 'none', 0) +
  circle(21, 21, 6.5, WHITE)
const compass =
  `<circle cx="116" cy="115" r="76" fill="none" stroke="${CANOPY}" stroke-width="13"/>` +
  path(
    'M 105,39 L 116,14 L 127,39 M 193,104 L 217,115 L 193,126 M 127,191 L 116,216 L 105,191 M 39,126 L 15,115 L 39,104',
    CANOPY,
    'none',
    0,
  ) +
  path(
    'M 51,47 L 148,53 L 148,129 L 179,184 L 123,182 L 107,172 L 96,166 L 90,149 L 82,140 L 81,123 L 76,112 L 78,97 L 68,85 L 65,66 Z',
    WHITE,
    CANOPY,
    2.6,
  ) +
  path('M 148,129 L 179,184 L 123,182 L 115,173 L 123,166 L 123,157 L 131,153 L 134,143 Z', MOSS, 'none', 0) +
  path('M 69,129 L 78,138 L 83,154 L 99,175 L 88,171 L 77,157 L 69,144 Z', WHITE, CANOPY, 2) +
  badgeLettering('BC', 117, 123, 19, CANOPY) +
  badgeLettering('N', 116, 14.5, 17, CANOPY) +
  badgeLettering('E', 224, 121, 17, CANOPY) +
  badgeLettering('S', 116, 227, 17, CANOPY) +
  badgeLettering('W', 8, 121, 17, CANOPY)
const navigation: ElementDef[] = [
  definition(
    'compass-bc',
    'Compass with BC inset',
    'navigation',
    232,
    229,
    compass,
    'Circle, cardinal arrows, letters and a deliberately schematic BC polygon.',
    [69, 37, 232, 229],
  ),
  definition(
    'dot-kamloops',
    'Kamloops dot',
    'navigation',
    28,
    28,
    ellipse(14, 14, 12, 11, MOSS, -12),
    'One slightly tilted ellipse.',
    [689, 509, 28, 28],
  ),
  definition(
    'flag-fernie',
    'Fernie flag',
    'navigation',
    69,
    94,
    flag(69, 94, 1),
    'Pole, stepped waving cloth and destination disc.',
    [1298, 632, 69, 94],
  ),
  definition(
    'flag-golden',
    'Golden flag',
    'navigation',
    68,
    94,
    flag(68, 94, -1),
    'Same flag grammar with a slight lean.',
    [1127, 313, 68, 94],
  ),
  definition(
    'flag-mount-robson',
    'Mount Robson flag',
    'navigation',
    68,
    95,
    flag(),
    'Pole, stepped waving cloth and destination disc.',
    [816, 14, 68, 95],
  ),
  definition(
    'mile-zero-leaf',
    'Mile zero leaf',
    'navigation',
    36,
    34,
    scaleDrawing(leaf('1', EMERALD), 59, 61, 36, 34),
    'Three-lobed leaf, stem and constructed numeral; small scale instance.',
    [293, 872, 36, 34],
  ),
  definition(
    'pin-vancouver',
    'Vancouver pin',
    'navigation',
    42,
    50,
    pin,
    'Rounded teardrop and circular white centre.',
    [382, 732, 42, 50],
  ),
  definition(
    'shield-1-east',
    'Highway 1 — east',
    'navigation',
    59,
    61,
    leaf('1'),
    'Three-lobed highway leaf and independently editable number.',
    [926, 431, 59, 61],
  ),
  definition(
    'shield-1-west',
    'Highway 1 — west',
    'navigation',
    59,
    61,
    leaf('1'),
    'Same leaf grammar; placement distinguishes the route marker.',
    [545, 564, 59, 61],
  ),
  definition(
    'shield-3-east',
    'Highway 3 — east',
    'navigation',
    53,
    49,
    shield('3'),
    'Five-point shield with two curved sides and constructed numeral.',
    [1188, 728, 53, 49],
  ),
  definition(
    'shield-3-west',
    'Highway 3 — west',
    'navigation',
    53,
    49,
    shield('3'),
    'Shared shield shape and constructed numeral.',
    [719, 742, 53, 49],
  ),
  definition(
    'shield-5-north',
    'Highway 5 — north',
    'navigation',
    53,
    49,
    shield('5'),
    'Shared shield shape and constructed numeral.',
    [801, 235, 53, 49],
  ),
  definition(
    'shield-5-south',
    'Highway 5 — south',
    'navigation',
    53,
    49,
    shield('5'),
    'Shared shield shape and constructed numeral.',
    [643, 584, 53, 49],
  ),
  definition(
    'shield-99',
    'Highway 99',
    'navigation',
    53,
    49,
    shield('99'),
    'Shared shield shape with a two-digit number width.',
    [366, 632, 53, 49],
  ),
]

const emeraldPlacements: [number, number, number, number][] = [
  [495, 41, 26, 35],
  [629, 55, 21, 29],
  [599, 186, 28, 40],
  [50, 326, 29, 40],
  [435, 318, 29, 40],
  [359, 466, 27, 38],
  [379, 449, 23, 38],
  [422, 461, 29, 38],
  [54, 591, 30, 43],
  [194, 765, 35, 51],
  [258, 845, 36, 51],
  [871, 327, 31, 44],
  [676, 673, 31, 43],
  [1327, 740, 31, 42],
]
const mossPlacements: [number, number, number, number][] = [
  [328, 271, 27, 34],
  [179, 459, 28, 38],
  [97, 739, 29, 38],
  [167, 815, 28, 38],
  [876, 203, 30, 40],
  [1031, 304, 25, 31],
  [422, 649, 25, 32],
  [603, 600, 21, 25],
  [762, 631, 31, 39],
]
const trees: ElementDef[] = [
  ...emeraldPlacements.map((box, index) =>
    definition(
      `tree-emerald-${String(index + 1).padStart(2, '0')}`,
      `Emerald tree ${index + 1}`,
      'tree',
      box[2],
      box[3],
      evergreenMarkup(box[2], box[3], index * 0.73),
      'Shared trunk and three pairs of branch tiers; dimensions and lean vary by instance.',
      box,
    ),
  ),
  ...mossPlacements.map((box, index) =>
    definition(
      `tree-moss-${String(index + 1).padStart(2, '0')}`,
      `Moss tree ${index + 1}`,
      'tree',
      box[2],
      box[3],
      mossTreeMarkup(box[2], box[3], index * 0.79),
      'Three tapered crown tiers and trunk; dimensions and lean vary by instance.',
      box,
    ),
  ),
]

const drafting: ElementDef[] = [
  definition(
    'blank-highway-leaf',
    'Blank highway leaf',
    'drafting',
    59,
    61,
    leaf(),
    'Reusable three-lobed leaf without a number.',
  ),
  definition(
    'blank-highway-shield',
    'Blank highway shield',
    'drafting',
    53,
    49,
    shield(),
    'Reusable curved shield without a number.',
  ),
  definition(
    'destination-flag',
    'Destination flag',
    'drafting',
    68,
    95,
    flag(),
    'Reusable pole, cloth and destination disc.',
  ),
  definition(
    'main-highway-line',
    'Main highway line',
    'drafting',
    178,
    44,
    path('M 7,33 C 44,36 55,10 88,17 S 133,36 171,10', 'none', EMERALD, 6.8),
    'One cubic centreline with rounded caps; 6.8 source-pixel stroke.',
  ),
  definition(
    'dashed-connector-line',
    'Dashed connector line',
    'drafting',
    178,
    44,
    `<g stroke-dasharray="8 9">${path('M 7,33 C 44,36 55,10 88,17 S 133,36 171,10', 'none', CANOPY, 4.3)}</g>`,
    'One curved centreline with an 8/9 dash rhythm.',
  ),
  definition(
    'illustration-leader',
    'Illustration leader',
    'drafting',
    178,
    44,
    `<g stroke-dasharray="4 4">${path('M 7,33 C 44,36 55,10 88,17 S 133,36 171,10', 'none', MOSS, 2.1)}</g>`,
    'One curved leader with a 4/4 dash rhythm.',
  ),
]

/** Hatch swatches are generated by the separate field algorithm, not this catalogue. */
export const ELEMENT_CATALOG: readonly ElementDef[] = [...illustrations, ...navigation, ...trees, ...drafting]

export function symbolMarkup(id: string): string {
  const element = ELEMENT_CATALOG.find((candidate) => candidate.id === id)
  if (!element) throw new Error(`Unknown illustrated-map element: ${id}`)
  return element.svg
}
