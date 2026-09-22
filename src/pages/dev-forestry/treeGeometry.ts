import type { ForestMesh, TreeSpeciesId } from './forest'

/** Small generated branch clusters, shared by all nearby stems of a species.
 * No model downloads. Unit height; crown width is scaled per instance. */
export function roadsideTreeMesh(species: TreeSpeciesId): ForestMesh {
  const p: number[] = [],
    n: number[] = [],
    bark: number[] = [],
    indices: number[] = []
  const triangle = (a: number[], b: number[], c: number[], woody: number) => {
    const u = b.map((v, i) => v - a[i]),
      v = c.map((v, i) => v - a[i])
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    const length = Math.hypot(...normal) || 1
    for (const vertex of [a, b, c]) {
      indices.push(p.length / 3)
      p.push(...vertex)
      n.push(...normal.map((x) => x / length))
      bark.push(woody)
    }
  }
  const stem = (a: number[], b: number[], radius: number) => {
    for (let i = 0; i < 5; i++) {
      const angle = (i * Math.PI * 2) / 5,
        next = ((i + 1) * Math.PI * 2) / 5
      const pa = [a[0] + Math.cos(angle) * radius, a[1] + Math.sin(angle) * radius, a[2]]
      const pb = [a[0] + Math.cos(next) * radius, a[1] + Math.sin(next) * radius, a[2]]
      const pc = [b[0] + Math.cos(angle) * radius * 0.45, b[1] + Math.sin(angle) * radius * 0.45, b[2]]
      const pd = [b[0] + Math.cos(next) * radius * 0.45, b[1] + Math.sin(next) * radius * 0.45, b[2]]
      triangle(pa, pb, pc, 1)
      triangle(pc, pb, pd, 1)
    }
  }
  const tuft = (x: number, y: number, z: number, r: number, h: number, phase: number) => {
    const sides = 5
    for (let i = 0; i < sides; i++) {
      const a = phase + (i * Math.PI * 2) / sides,
        b = phase + ((i + 1) * Math.PI * 2) / sides
      const pa = [x + Math.cos(a) * r, y + Math.sin(a) * r, z]
      const pb = [x + Math.cos(b) * r, y + Math.sin(b) * r, z]
      triangle(pa, pb, [x * 0.9, y * 0.9, z + h], 0)
      triangle(pb, pa, [x, y, z - h * 0.3], 0)
    }
  }
  stem([0, 0, 0], [0, 0, 1], species === 'aspen' ? 0.035 : 0.045)
  const bottom = species === 'pine' ? 0.5 : species === 'aspen' ? 0.48 : species === 'fir' ? 0.14 : 0.2
  for (let whorl = 0; whorl < 7; whorl++) {
    const t = whorl / 7,
      z = bottom + (1 - bottom) * t
    const spread = species === 'aspen' ? 0.44 * Math.sin((0.15 + t * 0.8) * Math.PI) : 0.5 * (1 - t) ** 0.85
    for (let j = 0; j < 5; j++) {
      const angle = (j * Math.PI * 2) / 5 + whorl * 2.399
      const x = Math.cos(angle) * spread * 0.65,
        y = Math.sin(angle) * spread * 0.65
      stem([0, 0, z + 0.04], [x, y, z], 0.009)
      tuft(x, y, z, spread * 0.45, (1 - bottom) * 0.2, angle)
    }
  }
  tuft(0, 0, 0.93, 0.065, 0.07, 0)
  return {
    attributes: {
      positions: { size: 3, value: new Float32Array(p) },
      normals: { size: 3, value: new Float32Array(n) },
      bark: { size: 1, value: new Float32Array(bark) },
    },
    indices: { size: 1, value: new Uint16Array(indices) },
  }
}
