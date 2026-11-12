// Trial only. A PGMaps forest scene package (src/pages/dev-forestry/scenePackage.ts) drawn by VistaWASM through its
// public API: the package's ground as a raw heightmap, PGMaps' own species models through setTreeModel, the
// package's stems through setTreeInstances, its camera through setCamera.
//
// This file is ours (MIT, like PGMaps) and only calls VistaWASM's documented API. VistaWASM itself is AGPL-3.0: it
// is installed by `npm install` here for the trial, never committed to PGMaps, never bundled into the app or its
// deploy. Whether PGMaps may ship it is an owner decision (docs/forestry-road-design/
// reference-repo-licensing-and-conversion.md); until then this stays a bench.
//
//   npm install && npm run dev, then open /?scene=<url of a package JSON> (or pick a file). Needs WebGPU.
//
// Frames: the package is x east, y north, z up; VistaWASM is +Y up, terrain centred on the origin, rows along +Z.
// North is put at −Z (rows reversed) so its right-handed camera does not mirror east and west.
import { createVistaEngine, initialiseVistaWasm, type TreeSpecies } from '@vista-wasm/vista-wasm'

type ScenePackage = {
  format: 'pgmaps-forest-scene'
  version: 1
  terrain: { west: number; south: number; spacing: number; columns: number; rows: number; heights: Array<number | null> }
  trees: { fields: string[]; species: string[]; count: number; data: number[] }
  species: Record<string, { crownRatio: number; broadleaf: boolean }>
  models?: Record<string, { positions: number[]; normals: number[]; bark: number[] }>
  camera: { position: [number, number, number]; bearingDegrees: number; pitchDegrees: number; verticalFovDegrees: number }
}

const params = new URLSearchParams(location.search)
const hud = document.getElementById('hud') as HTMLElement
const status = (text: string) => {
  hud.textContent = text
}
;(window as unknown as { pgmaps: { ready: boolean; error?: string } }).pgmaps = { ready: false }

async function loadScene(): Promise<ScenePackage> {
  const url = params.get('scene')
  if (url) return (await fetch(url)).json()
  status('choose a PGMaps scene package (forestry-scene-package.json)')
  const input = document.getElementById('file') as HTMLInputElement
  input.hidden = false
  return new Promise((resolve) => {
    input.onchange = async () => resolve(JSON.parse(await (input.files as FileList)[0].text()))
  })
}

/** VistaWASM has eight species slots; which one each PGMaps species takes is arbitrary, the model is ours. */
const SLOT: Record<string, TreeSpecies> = {
  pine: 'pine',
  spruce: 'spruce',
  fir: 'cypress',
  douglasFir: 'oak',
  aspen: 'jungle',
  birch: 'acacia',
}
/** setTreeInstances takes one uniform scale (at most 20): models are built at this height and scaled from it. */
const MODEL_HEIGHT = 20

async function main() {
  const scene = await loadScene()
  if (scene.format !== 'pgmaps-forest-scene' || scene.version !== 1) throw new Error('Not a PGMaps forest scene package (v1).')
  if (!scene.models) throw new Error('This package has no species models; export it again from PGMaps.')
  if (!('gpu' in navigator)) throw new Error('VistaWASM needs WebGPU, which this browser does not offer.')

  status('starting VistaWASM…')
  await initialiseVistaWasm()
  const canvas = document.getElementById('vista') as HTMLCanvasElement
  canvas.width = canvas.clientWidth
  canvas.height = canvas.clientHeight
  const engine = await createVistaEngine(canvas, {
    render: { width: canvas.clientWidth, height: canvas.clientHeight, devicePixelRatio: Math.min(devicePixelRatio, 1.5) },
  })

  // ---------------------------------------------------------------- ground
  // Gaps (no source DEM there) take the nearest known height along their row, then their column.
  const { columns, rows, spacing } = scene.terrain
  const heights = scene.terrain.heights.slice()
  const fill = (index: (i: number, j: number) => number, outer: number, inner: number) => {
    for (let i = 0; i < outer; i++) {
      let last: number | null = null
      for (let j = 0; j < inner; j++) last = heights[index(i, j)] ?? last
      for (let j = inner - 1; j >= 0; j--) {
        const k = index(i, j)
        if (heights[k] === null) heights[k] = last
        else last = heights[k]
      }
    }
  }
  fill((r, c) => r * columns + c, rows, columns)
  fill((c, r) => r * columns + c, columns, rows)
  const samples = new Float32Array(columns * rows)
  // Row 0 of the package is the south edge; VistaWASM's row 0 is −Z, which is north here.
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) samples[r * columns + c] = heights[(rows - 1 - r) * columns + c] ?? 0
  status('loading the ground…')
  await engine.loadRawHeightmap(samples.slice().buffer, {
    width: columns,
    height: rows,
    sampleFormat: 'float32',
    metresPerSample: spacing,
    heightScaleMetres: 1,
  })

  // ---------------------------------------------------------------- the species: PGMaps' own models
  // A model's crown width is the median crown-to-height ratio of its stems in the package: setTreeInstances scales
  // uniformly, so a stem keeps its height but not its own crown width (PGMaps draws both).
  const stride = scene.trees.fields.length
  for (const [index, id] of scene.trees.species.entries()) {
    const model = scene.models[id]
    const slot = SLOT[id]
    if (!model || !slot) continue
    const ratios: number[] = []
    for (let i = 0; i < scene.trees.count; i++) {
      const o = i * stride
      if (scene.trees.data[o + 3] === index) ratios.push(scene.trees.data[o + 5] / scene.trees.data[o + 4])
    }
    if (ratios.length === 0) continue
    ratios.sort((a, b) => a - b)
    const across = MODEL_HEIGHT * ratios[Math.floor(ratios.length / 2)]
    const n = model.positions.length / 3
    const positions = new Float32Array(n * 3)
    const normals = new Float32Array(n * 3)
    for (let v = 0; v < n; v++) {
      // package (x east, y north, z up) at unit size → VistaWASM metres (x east, y up, z south)
      positions.set([model.positions[v * 3] * across, model.positions[v * 3 + 2] * MODEL_HEIGHT, -model.positions[v * 3 + 1] * across], v * 3)
      normals.set([model.normals[v * 3], model.normals[v * 3 + 2], -model.normals[v * 3 + 1]], v * 3)
    }
    engine.setTreeModel(slot, {
      positions,
      normals,
      uvs: new Float32Array(n * 2),
      indices: Uint32Array.from({ length: n }, (_, i) => i),
      // Wood on a bark layer, foliage on a leaf layer (4 and up flutter in the wind).
      textureLayers: Float32Array.from(model.bark, (wood) => (wood ? 0 : 4)),
    })
  }

  // ---------------------------------------------------------------- the stems
  const trees = []
  for (let i = 0; i < scene.trees.count; i++) {
    const o = i * stride
    const slot = SLOT[scene.trees.species[scene.trees.data[o + 3]]]
    if (!slot) continue
    trees.push({
      x: scene.trees.data[o],
      y: scene.trees.data[o + 2],
      z: -scene.trees.data[o + 1],
      species: slot,
      scale: Math.min(20, Math.max(0.05, scene.trees.data[o + 4] / MODEL_HEIGHT)),
      rotation: (scene.trees.data[o + 6] * Math.PI * 2) % (Math.PI * 2),
      tint: scene.trees.data[o + 6],
    })
  }
  engine.setTreeInstances(trees)

  // ---------------------------------------------------------------- the eye
  const { camera } = scene
  const bearing = (camera.bearingDegrees * Math.PI) / 180
  const pitch = (camera.pitchDegrees * Math.PI) / 180
  const eye: [number, number, number] = [camera.position[0], camera.position[2], -camera.position[1]]
  engine.setCamera({
    position: eye,
    target: [
      eye[0] + Math.sin(bearing) * Math.cos(pitch) * 100,
      eye[1] + Math.sin(pitch) * 100,
      eye[2] - Math.cos(bearing) * Math.cos(pitch) * 100,
    ],
    fieldOfViewDegrees: camera.verticalFovDegrees,
    nearMetres: 0.3,
  })
  engine.start()
  status(`VistaWASM · ${trees.length.toLocaleString()} stems from the package (uniform scale: crown width per species)`)
  // For comparisons: the engine's own snapshot of its last frame, as a data URL.
  const hook = (
    window as unknown as {
      pgmaps: { ready: boolean; snapshot?: () => Promise<string>; renderOnce?: () => unknown }
    }
  ).pgmaps
  // One frame drawn now, with its counts (trees drawn, tree and terrain triangles): evidence of what the engine drew
  // even where the canvas cannot be read back (a software WebGPU adapter, for one).
  hook.renderOnce = () => engine.renderOnce()
  hook.snapshot = async () => {
    const blob = await engine.exportSnapshot({ mimeType: 'image/png' })
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsDataURL(blob)
    })
  }
  setTimeout(() => {
    hook.ready = true
  }, 5000)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  status(`failed: ${message}`)
  ;(window as unknown as { pgmaps: { ready: boolean; error?: string } }).pgmaps = { ready: true, error: message }
})
