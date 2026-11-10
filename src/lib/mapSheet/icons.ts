/**
 * Point and marker icons drawn from simple vector parts, so the sheet's PDF, its SVG preview, the
 * legend and the MapLibre map draw the same shape. They are PGMaps' own drawings, made to read like
 * the usual map symbols at 5–12 pt; nothing is taken from a symbol font. Coordinates are in a unit
 * box from −0.5 to 0.5 with y down, and widths are fractions of the box. Along a line, the icon's
 * x axis follows the line. No DOM or network access.
 */
import type { Point } from './drawOps'

/** A colour slot the symbol fills in, or a literal colour. */
export type IconPaint = 'primary' | 'secondary' | (string & {})

export type IconPart =
  | {
      type: 'poly'
      points: Point[]
      closed: boolean
      fill?: IconPaint
      stroke?: IconPaint
      /** Stroke width, fraction of the box. */
      width?: number
    }
  | { type: 'circle'; cx: number; cy: number; r: number; fill?: IconPaint; stroke?: IconPaint; width?: number }

export interface IconDef {
  label: string
  parts: IconPart[]
}

const arc = (cx: number, cy: number, r: number, from: number, to: number, steps = 12): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((from + ((to - from) * i) / steps) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
const line = (stroke: IconPaint, width: number, ...points: Point[]): IconPart => ({
  type: 'poly',
  points,
  closed: false,
  stroke,
  width,
})
const shape = (points: Point[], fill?: IconPaint, stroke?: IconPaint, width?: number): IconPart => ({
  type: 'poly',
  points,
  closed: true,
  ...(fill ? { fill } : {}),
  ...(stroke ? { stroke, width } : {}),
})
const circle = (cx: number, cy: number, r: number, fill?: IconPaint, stroke?: IconPaint, width?: number): IconPart => ({
  type: 'circle',
  cx,
  cy,
  r,
  ...(fill ? { fill } : {}),
  ...(stroke ? { stroke, width } : {}),
})
/** Parts scaled about the centre and moved, with colour slots renamed. */
function placed(parts: IconPart[], scale: number, dx = 0, dy = 0, paints: Record<string, IconPaint> = {}): IconPart[] {
  const paint = (value?: IconPaint) => (value ? (paints[value] ?? value) : undefined)
  return parts.map((part) =>
    part.type === 'circle'
      ? {
          ...part,
          cx: part.cx * scale + dx,
          cy: part.cy * scale + dy,
          r: part.r * scale,
          fill: paint(part.fill),
          stroke: paint(part.stroke),
          width: part.width && part.width * scale,
        }
      : {
          ...part,
          points: part.points.map(([x, y]) => [x * scale + dx, y * scale + dy] as Point),
          fill: paint(part.fill),
          stroke: paint(part.stroke),
          width: part.width && part.width * scale,
        },
  )
}

const fishBody: Point[] = [...arc(-0.1, 0, 0.3, 0, 360, 20).map(([x, y]) => [x, y * 0.6] as Point)]
const culvert: IconPart[] = [circle(0, 0, 0.3, undefined, 'primary', 0.1), line('primary', 0.1, [-0.5, 0], [0.5, 0])]

export const ICONS = {
  dot: { label: 'Dot', parts: [circle(0, 0, 0.45, 'primary')] },
  tick: { label: 'Cross tick', parts: [line('primary', 0.1, [0, -0.5], [0, 0.5])] },
  'tick-side': { label: 'Tick on one side', parts: [line('primary', 0.12, [0, 0], [0, 0.5])] },
  cross: {
    label: 'Cross',
    parts: [line('primary', 0.14, [-0.4, -0.4], [0.4, 0.4]), line('primary', 0.14, [-0.4, 0.4], [0.4, -0.4])],
  },
  diamond: {
    label: 'Diamond',
    parts: [
      shape(
        [
          [0, -0.5],
          [0.5, 0],
          [0, 0.5],
          [-0.5, 0],
        ],
        'primary',
        'secondary',
        0.18,
      ),
    ],
  },
  tower: {
    label: 'Tower',
    parts: [
      shape(
        [
          [-0.3, -0.3],
          [0.3, -0.3],
          [0.3, 0.3],
          [-0.3, 0.3],
        ],
        'secondary',
        'primary',
        0.14,
      ),
    ],
  },
  'spot-height': {
    label: 'Spot height',
    parts: [
      line('primary', 0.12, [-0.5, 0], [0.5, 0]),
      line('primary', 0.12, [0, -0.5], [0, 0.5]),
      circle(0, 0, 0.14, 'primary'),
    ],
  },
  fish: {
    label: 'Fish',
    parts: [
      shape(fishBody, 'primary'),
      shape(
        [
          [0.15, 0],
          [0.48, -0.24],
          [0.48, 0.24],
        ],
        'primary',
      ),
      circle(-0.26, -0.04, 0.05, 'secondary'),
    ],
  },
  'fish-barrier': {
    label: 'Fish barrier',
    parts: [
      ...placed(
        [
          { type: 'poly', points: fishBody, closed: true, stroke: 'primary', width: 0.12 },
          line('primary', 0.12, [0.15, 0], [0.48, -0.24], [0.48, 0.24], [0.15, 0]),
        ],
        0.8,
        -0.12,
      ),
      shape(
        [
          [0.3, -0.48],
          [0.46, -0.48],
          [0.46, 0.48],
          [0.3, 0.48],
        ],
        'primary',
      ),
    ],
  },
  diversion: {
    label: 'Point of diversion',
    parts: [
      circle(0, 0, 0.42, 'primary', 'secondary', 0.1),
      line('secondary', 0.1, [-0.24, 0], [0.24, 0]),
      line('secondary', 0.1, [0.06, -0.17], [0.25, 0], [0.06, 0.17]),
    ],
  },
  'scenic-p': {
    label: 'Scenic area',
    parts: [
      line('primary', 0.14, [-0.18, 0.46], [-0.18, -0.44]),
      line('primary', 0.14, [-0.18, -0.44], ...arc(0.04, -0.2, 0.24, -90, 90), [-0.18, 0.04]),
    ],
  },
  wellsite: {
    label: 'Wellsite',
    parts: [
      circle(0, 0, 0.24, undefined, 'primary', 0.1),
      ...[45, 135, 225, 315].map((a) => {
        const r = (a * Math.PI) / 180
        return line('primary', 0.1, [0.24 * Math.cos(r), 0.24 * Math.sin(r)], [0.5 * Math.cos(r), 0.5 * Math.sin(r)])
      }),
    ],
  },
  bridge: {
    label: 'Bridge',
    parts: [
      line('primary', 0.1, [-0.46, -0.36], [-0.28, -0.16], [0.28, -0.16], [0.46, -0.36]),
      line('primary', 0.1, [-0.46, 0.36], [-0.28, 0.16], [0.28, 0.16], [0.46, 0.36]),
    ],
  },
  culvert: { label: 'Culvert', parts: culvert },
  'pipe-arch': {
    label: 'Pipe arch',
    parts: [
      shape([...arc(0, 0.22, 0.34, 180, 360)], 'secondary', 'primary', 0.1),
      line('primary', 0.1, [-0.46, 0.22], [0.46, 0.22]),
    ],
  },
  'structure-nonfunctioning': {
    label: 'Non-functioning structure',
    parts: [circle(0, 0, 0.48, 'primary', '#000000', 0.06), ...placed(culvert, 0.75, 0, 0, { primary: '#000000' })],
  },
  'structure-removed': {
    label: 'Removed structure',
    parts: [
      ...placed(culvert, 0.85, 0, 0, { primary: '#000000' }),
      line('primary', 0.12, [-0.4, -0.4], [0.4, 0.4]),
      line('primary', 0.12, [-0.4, 0.4], [0.4, -0.4]),
    ],
  },
  gate: {
    label: 'Gate',
    parts: [
      line('primary', 0.14, [-0.32, 0], [0.46, 0]),
      line('primary', 0.12, [-0.4, -0.4], [-0.4, 0.4]),
      circle(-0.4, 0, 0.1, 'primary'),
    ],
  },
  'cattle-guard': {
    label: 'Cattle guard',
    parts: [
      shape(
        [
          [-0.42, -0.3],
          [0.42, -0.3],
          [0.42, 0.3],
          [-0.42, 0.3],
        ],
        undefined,
        'primary',
        0.08,
      ),
      ...[-0.21, 0, 0.21].map((x) => line('primary', 0.08, [x, -0.3], [x, 0.3])),
    ],
  },
  'access-control': {
    label: 'Access control',
    parts: [
      circle(0, 0, 0.42, undefined, 'primary', 0.1),
      shape(
        [
          [-0.3, -0.08],
          [0.3, -0.08],
          [0.3, 0.08],
          [-0.3, 0.08],
        ],
        'primary',
      ),
    ],
  },
  'railway-crossing': {
    label: 'Railway crossing',
    parts: [
      circle(0, 0, 0.46, undefined, 'primary', 0.08),
      line('primary', 0.1, [-0.26, -0.26], [0.26, 0.26]),
      line('primary', 0.1, [-0.26, 0.26], [0.26, -0.26]),
    ],
  },
  'pipeline-crossing': {
    label: 'Pipeline crossing',
    parts: [
      circle(0, 0, 0.42, undefined, 'primary', 0.1),
      line('primary', 0.1, [-0.42, -0.1], [0.42, -0.1]),
      line('primary', 0.1, [-0.42, 0.1], [0.42, 0.1]),
    ],
  },
  'skid-crossing': {
    label: 'Skid crossing',
    parts: [
      line('primary', 0.1, [-0.42, 0], [0.42, 0]),
      line('primary', 0.1, [-0.22, -0.2], [-0.44, 0], [-0.22, 0.2]),
      line('primary', 0.1, [0.22, -0.2], [0.44, 0], [0.22, 0.2]),
    ],
  },
  pit: {
    label: 'Pit',
    parts: [
      circle(0, 0, 0.44, 'secondary', 'primary', 0.08),
      circle(-0.16, -0.1, 0.07, 'primary'),
      circle(0.16, -0.1, 0.07, 'primary'),
      circle(0, 0.16, 0.07, 'primary'),
    ],
  },
  quarry: {
    label: 'Quarry',
    parts: [
      line('primary', 0.1, [-0.36, -0.36], [0.36, 0.36]),
      line('primary', 0.1, [-0.36, 0.36], [0.36, -0.36]),
      line('primary', 0.14, [-0.46, -0.2], [-0.2, -0.46]),
      line('primary', 0.14, [0.46, -0.2], [0.2, -0.46]),
    ],
  },
  'sand-pit': {
    label: 'Sand pit',
    parts: [
      circle(0, 0, 0.44, 'secondary', 'primary', 0.08),
      ...(
        [
          [-0.18, -0.14],
          [0.12, -0.2],
          [-0.04, 0.02],
          [0.2, 0.12],
          [-0.16, 0.2],
        ] as Point[]
      ).map(([x, y]) => circle(x, y, 0.045, 'primary')),
    ],
  },
  'shale-pit': {
    label: 'Shale pit',
    parts: [
      circle(0, 0, 0.44, 'secondary', 'primary', 0.08),
      ...[-0.16, 0, 0.16].map((y) => line('primary', 0.07, [-0.26, y], [0.26, y])),
    ],
  },
  'plot-circle': { label: 'Plot', parts: [circle(0, 0, 0.42, 'primary', 'secondary', 0.143)] },
  tree: {
    label: 'Tree',
    parts: [
      shape(
        [
          [0, -0.5],
          [0.34, 0.2],
          [-0.34, 0.2],
        ],
        'primary',
      ),
      shape(
        [
          [-0.06, 0.2],
          [0.06, 0.2],
          [0.06, 0.48],
          [-0.06, 0.48],
        ],
        'primary',
      ),
    ],
  },
  warning: {
    label: 'Warning',
    parts: [
      shape(
        [
          [0, -0.46],
          [0.48, 0.4],
          [-0.48, 0.4],
        ],
        'primary',
        'secondary',
        0.08,
      ),
      line('secondary', 0.1, [0, -0.16], [0, 0.12]),
      circle(0, 0.26, 0.05, 'secondary'),
    ],
  },
  marsh: {
    label: 'Marsh mark',
    parts: [
      line('primary', 0.08, [-0.42, 0.3], [0.42, 0.3]),
      line('primary', 0.08, [0, 0.3], [0, -0.42]),
      line('primary', 0.08, [-0.12, 0.3], [-0.3, -0.18]),
      line('primary', 0.08, [0.12, 0.3], [0.3, -0.18]),
    ],
  },
} satisfies Record<string, IconDef>

export type IconId = keyof typeof ICONS
export const ICON_IDS = Object.keys(ICONS) as IconId[]
