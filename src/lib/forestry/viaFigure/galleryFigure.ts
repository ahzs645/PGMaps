/**
 * A synthetic road view for the figure-style gallery: a drawn hillside under a sky, and its class
 * pass with a landform, two blocks (one hidden), an existing opening, private land and rock. Nothing
 * here is real data or a real photograph. No DOM or network access.
 */
import { CLASS_PALETTE, decodeClassRaster, type ClassRaster, type FigureClass, type FigureInput } from './composeFigure'
import type { ViaStylePreset } from './presets'

export const GALLERY_FIGURE_SIZE = { width: 480, height: 200 } as const

/** Height of the far ridge and the near slope's crest at column `x`, in rows from the top. */
const ridge = (x: number, w: number) => 70 + 18 * Math.sin((x / w) * Math.PI * 2.2) + 8 * Math.sin((x / w) * 17)

function classAt(x: number, y: number, w: number): Exclude<FigureClass, 'sky'> | null {
  if (y < ridge(x, w)) return null
  const inLandform = x > 90 && x < 400 && y > ridge(x, w) + 4 && y < 170
  const ellipse = (cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1
  if (ellipse(210, 120, 34, 16)) return inLandform ? 'proposedIn' : 'proposedOut'
  if (ellipse(300, 110, 22, 10)) return inLandform ? 'existingIn' : 'existingOut'
  if (ellipse(360, 150, 28, 12)) return inLandform ? 'privateIn' : 'privateOut'
  if (ellipse(140, 100, 16, 9) && inLandform) return 'rock'
  if (ellipse(40, 150, 20, 10)) return 'proposedOut'
  return inLandform ? 'landform' : 'terrain'
}

/** The drawn view (a muted landscape) and its class pass, both `GALLERY_FIGURE_SIZE`. */
export function galleryRasters() {
  const { width: w, height: h } = GALLERY_FIGURE_SIZE
  const image = new Uint8ClampedArray(w * h * 4)
  const classes = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const name = classAt(x, y, w)
      if (!name) {
        const t = y / h
        image.set([150 + 60 * t, 185 + 40 * t, 220 + 20 * t, 255], o)
        continue
      }
      classes.set([...CLASS_PALETTE[name], 255], o)
      const shade = 0.75 + 0.25 * Math.sin(x / 9 + y / 13)
      const cleared = name.startsWith('proposed') || name.startsWith('existing')
      const base = cleared ? [176, 150, 112] : name === 'rock' ? [150, 146, 138] : [58, 86, 52]
      image.set([base[0] * shade, base[1] * shade, base[2] * shade, 255], o)
    }
  return { image, classes, width: w, height: h }
}

/** A complete figure input for `preset` from the synthetic view. */
export function galleryFigureInput(preset: ViaStylePreset): FigureInput {
  const { image, classes, width, height } = galleryRasters()
  return {
    preset,
    image: { kind: 'rgba', data: image, width, height },
    classes: decodeClassRaster(classes, width, height),
    callouts: [
      { title: 'Block 1', body: 'Visible', anchor: [210, 120], focus: true },
      { title: 'Block 2', body: 'Likely Not Visible', anchor: [40, 150] },
    ],
    sightlinePercent: 7.2,
    sightlineClass: 'Partial Retention',
    lens: 'synthetic view, 50 mm equivalent (39.6° horizontal)',
    titles: { area: 'Sample Creek', viewpoint: 'Viewpoint 1', n: '1', licence: 'A00000' },
    facts: [
      { label: 'Viewpoint', value: 'Sample FSR, km 4' },
      { label: 'Distance to block', value: '2.1 km' },
    ],
    rating: { vsu: '12', vsc: '2', vac: 'L', evc: 'R', vqo: 'PR' },
    zones: galleryZones(),
    camera: {
      frames: 1,
      focalMm: 50,
      fovDeg: 39.6,
      observerHeightM: 1.6,
      above: 'ground',
      lng: -122.6,
      lat: 53.9,
      elevationM: 700,
      azimuthDeg: 112,
      maxTreeHeightM: 25,
      renderedOn: new Date('2026-11-11T12:00:00Z'),
    },
    generatedAt: new Date('2026-11-11T12:00:00Z'),
  }
}

/** Synthetic VQO zones over the gallery view's terrain: Retention west of the middle, Partial Retention east. */
function galleryZones(): ClassRaster {
  const { width: w, height: h } = GALLERY_FIGURE_SIZE
  const codes = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y >= ridge(x, w)) codes[y * w + x] = x < w * 0.55 ? 2 : 3
  return { width: w, height: h, codes }
}
