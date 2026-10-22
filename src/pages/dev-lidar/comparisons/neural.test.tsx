import { readFileSync } from 'node:fs'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { NeuralViews } from './NeuralComparison'
import { checkNeuralSnapshot, neuralAssignments, neuralCrop, neuralCoverage, type NeuralSnapshot } from './neuralData'
vi.mock('./ComparisonMap', () => ({
  ComparisonMap: (p: {
    crop?: { id: string }
    features?: { features: unknown[] }
    assignments: Record<string, string>
  }) => (
    <div
      data-map="neural"
      data-crop={p.crop?.id}
      data-features={p.features?.features.length}
      data-labels={p.assignments}
    />
  ),
  sameCamera: () => true,
}))
vi.mock('./ComparisonProfile', () => ({
  ComparisonProfile: (p: { angle: number; crop: { id: string } }) => (
    <div data-profile={p.crop.id} data-angle={p.angle} />
  ),
}))
const snapshot: NeuralSnapshot = JSON.parse(readFileSync(new URL('./neural.generated.json', import.meta.url), 'utf8'))
describe('matched preliminary neural results', () => {
  it('checks coverage and original-row label alignment in the actual artifact', () => {
    expect(() => checkNeuralSnapshot(snapshot, snapshot.source_sha256)).not.toThrow()
    expect(snapshot.common_chunks).toBe(416)
    expect(snapshot.common_returns).toBe(39346491)
    expect(snapshot.assignment_disagreement_returns).toBe(6360525)
    expect(snapshot.models.sat.assigned).toBe(25149492)
    expect(snapshot.models.forainet.assigned).toBe(22016451)
    expect(snapshot.common_returns).toBeLessThan(snapshot.total_returns)
    const sample = snapshot.samples[0],
      crop = neuralCrop(snapshot, sample)
    expect(crop.budget_limited).toBe(true)
    for (const model of ['sat', 'forainet'] as const) {
      const labels = neuralAssignments(sample, model, 'instance')
      for (let i = 0; i < crop.points.length; i++) {
        const p = crop.points[i]
        expect(p.index).toBe(sample.points[i][4])
        expect(labels[`${p.node}:${p.index}`]).toBe(
          sample.models[model].instance[i] < 0 ? '0' : `${model}-candidate-${sample.models[model].instance[i]}`,
        )
      }
    }
    expect(neuralCoverage(snapshot, 'sat', true)).toEqual(neuralCoverage(snapshot, 'forainet', true))
  })
  it('rejects wrong sources, incomplete labels and overstated completion', () => {
    expect(() => checkNeuralSnapshot(snapshot, 'wrong-source')).toThrow(/different LiDAR/)
    expect(() => checkNeuralSnapshot({ ...snapshot, whole_tile_complete: true })).toThrow(/execution scope/)
    expect(() => checkNeuralSnapshot({ ...snapshot, samples: [] })).toThrow(/samples/)
    const broken = structuredClone(snapshot)
    broken.samples[0].models.sat.instance.pop()
    expect(() => checkNeuralSnapshot(broken)).toThrow(/labels/)
  })
  it('switches coverage, matched 3D points, semantic colours and rotated side profiles', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<NeuralViews data={snapshot} basemap="none" />)
    })
    const maps = () => renderer!.root.findAllByProps({ 'data-map': 'neural' })
    const select = (label: string, value: string) =>
      act(async () =>
        renderer!.root
          .findAllByType(SegmentedControl)
          .find((n) => n.props.label === label)!
          .props.onChange(value),
      )
    expect(maps().map((m) => m.props['data-features'])).toEqual([416, 416])
    expect(maps()[0].props['data-crop']).toBeUndefined()
    await select('Neural comparison view', '3d')
    expect(maps().map((m) => m.props['data-crop'])).toEqual([snapshot.samples[0].id, snapshot.samples[0].id])
    expect(maps()[0].props['data-features']).toBeUndefined()
    await select('Neural point colours', 'semantic')
    expect(Object.values(maps()[0].props['data-labels']).every((v) => String(v).startsWith('sat-class-'))).toBe(true)
    await act(async () =>
      renderer!.root
        .findByProps({ 'aria-label': 'Neural point sample' })
        .props.onChange({ target: { value: snapshot.samples[1].id } }),
    )
    expect(maps()[0].props['data-crop']).toBe(snapshot.samples[1].id)
    await select('Neural comparison view', 'profile')
    expect(maps()).toHaveLength(0)
    await act(async () =>
      renderer!.root
        .findByProps({ 'aria-label': 'Neural profile rotation' })
        .props.onChange({ target: { value: '90' } }),
    )
    expect(renderer!.root.findAll((n) => n.props['data-profile']).map((n) => n.props['data-angle'])).toEqual([90, 90])
    await act(async () => renderer!.unmount())
  })
})
