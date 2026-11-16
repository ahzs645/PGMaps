import { describe, expect, it } from 'vitest'
import { assembledSection } from './assembledSection'
import { createEngineeringDesign, type GroundMaterial } from './engineeringTypes'
import { DEFAULT_TEMPLATE } from './terrain'
import type { Alignment } from './types'

// RoadEng's tutorial stage 7 ran the page out of memory: its horizons share a depth (one's bottom is
// the next one's top) and its TIN reads a few micrometres apart either side of a facet edge, so the
// cut batter's boundary search pinned its step to where it started and the batter grew one
// identical point at a time without end. Here the ground steps 20 µm exactly where the batter
// crosses that shared depth.
const material = (id: string, cutSlope: number): GroundMaterial => ({
  id,
  name: id,
  color: '#888888',
  cutRate: 10,
  reusableFraction: 1,
  compactionFactor: 1,
  cutSlope,
})

function road(): Alignment {
  return {
    id: 'r',
    name: 'Stage 7',
    color: '#000000',
    points: [],
    vertical: [],
    template: { ...DEFAULT_TEMPLATE, cutSlopeFrom: 'material' },
    overrides: [],
    engineering: {
      ...createEngineeringDesign(),
      materials: [material('OB', 1), material('CS', 1), material('FR', 0.5)],
      strata: [
        { id: 'h1', start: 0, end: 100, materialId: 'OB', topDepthM: 0, bottomDepthM: 0.3048 },
        { id: 'h2', start: 0, end: 100, materialId: 'CS', topDepthM: 0.3048, bottomDepthM: 1.524 },
        { id: 'h3', start: 0, end: 100, materialId: 'FR', topDepthM: 1.524, bottomDepthM: null },
      ],
    },
  }
}

function section(ground: (offset: number) => number | null) {
  const alignment = road()
  return assembledSection({
    alignment,
    template: alignment.template,
    chainage: 50,
    elevation: 100,
    leftWidth: alignment.template.leftWidth,
    rightWidth: alignment.template.rightWidth,
    halfWidth: 35,
    ground,
    curve: null,
    ditchDipLimit: 3,
    coordinate: [0, 0],
    heading: 0,
    surfaceAt: () => null,
  })
}

describe('cut batter across a horizon boundary', () => {
  it('finishes where the ground steps exactly on a depth two horizons share', () => {
    const level = 106
    // Where the batter crosses 1.524 m below continuous ground.
    const smooth = section(() => level)
    expect(smooth.complete).toBe(true)
    const right = smooth.section.filter((p) => p.offset > 0 && p.design !== null)
    const crossing = right.find((p) => Math.abs(level - p.design! - 1.524) < 1e-6)
    expect(crossing).toBeDefined()
    for (let k = -10; k <= 10; k++) {
      const jump = crossing!.offset + k * 1e-10
      const stepped = section((offset) => (Math.abs(offset) < jump ? level + 1e-5 : level - 1e-5))
      expect(stepped.complete).toBe(true)
      expect(stepped.rightDaylightM).toBeCloseTo(smooth.rightDaylightM!, 3)
      expect(stepped.section.length).toBeLessThan(smooth.section.length + 20)
    }
  })
})
