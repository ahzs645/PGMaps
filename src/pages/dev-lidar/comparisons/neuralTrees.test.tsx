import { readFileSync } from 'node:fs'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { NeuralTreeViews } from './NeuralTreeInspector'
import {
  checkTreeExamples,
  treeExampleCrop,
  treeExampleAssignments,
  treePointCsv,
  type NeuralTreeExamples,
} from './neuralTrees'
import type { NeuralSnapshot } from './neuralData'
import type { TreeCrop } from '../treeIsolation'
vi.mock('./ComparisonMap', () => ({
  ComparisonMap: (p: {
    label: string
    crop?: TreeCrop
    assignments?: Record<string, string>
    onFeaturePick?: (id: string) => void
  }) => <div data-map={p.label} data-crop={p.crop} data-labels={p.assignments} data-select={p.onFeaturePick} />,
}))
vi.mock('./ComparisonProfile', () => ({
  ComparisonProfile: (p: { crop: TreeCrop; angle: number; colour: string }) => (
    <div data-profile={p.crop} data-angle={p.angle} data-colour={p.colour} />
  ),
}))
const read = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
const examples: NeuralTreeExamples = read('./neural-trees.generated.json')
const snapshot: NeuralSnapshot = read('./neural.generated.json')
describe('individual neural tree examples', () => {
  it('retains every exported candidate point and rejects mismatched provenance or missing points', () => {
    expect(() => checkTreeExamples(examples, snapshot)).not.toThrow()
    expect(examples.trees).toHaveLength(147)
    expect(examples.trees.reduce((n, t) => n + t.core_returns, 0)).toBe(210336)
    const tree = examples.trees[0],
      crop = treeExampleCrop(examples, tree)
    expect(crop.points.length).toBe(tree.core_returns)
    expect(crop.budget_limited).toBe(false)
    expect(crop.points.map((p) => p.index)).toEqual(tree.points.map((p) => p[4]))
    expect(Object.values(treeExampleAssignments(tree, crop, false)).every((v) => v === tree.id)).toBe(true)
    expect(treePointCsv(examples, tree).trim().split('\n')).toHaveLength(tree.core_returns + 2)
    expect(() => checkTreeExamples({ ...examples, source_sha256: 'other' }, snapshot)).toThrow(/match/)
    const broken = { ...examples, trees: [{ ...tree, points: tree.points.slice(1) }] }
    expect(() => checkTreeExamples(broken, snapshot)).toThrow(/points/)
  })
  it('adds sampled context without duplicating candidate returns or assigning neighbours to the tree', () => {
    const tree = examples.trees[0],
      sample = snapshot.samples.find((s) => s.id === tree.chunk)!
    const crop = treeExampleCrop(examples, tree, sample),
      labels = treeExampleAssignments(tree, crop, false)
    expect(crop.points.length).toBeGreaterThan(tree.core_returns)
    expect(new Set(crop.points.map((p) => p.index)).size).toBe(crop.points.length)
    expect(Object.values(labels).filter((v) => v === tree.id)).toHaveLength(tree.core_returns)
    expect(Object.values(labels).filter((v) => v === '0')).toHaveLength(crop.points.length - tree.core_returns)
  })
  it('selects individual trees by marker and next, switches models and rotates the same isolated profile', async () => {
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<NeuralTreeViews data={examples} snapshot={snapshot} basemap="none" />)
    })
    const map = () => renderer!.root.findByProps({ 'data-map': 'Isolated neural tree 3D map' })
    const select = (label: string, value: string) =>
      act(async () =>
        renderer!.root
          .findAllByType(SegmentedControl)
          .find((n) => n.props.label === label)!
          .props.onChange(value),
      )
    expect(map().props['data-crop'].id).toBe(examples.trees[0].id)
    expect(renderer!.root.find((n) => !!n.props['data-profile']).props['data-profile']).toEqual(
      map().props['data-crop'],
    )
    await act(async () => renderer!.root.findByProps({ 'aria-label': 'Next tree candidate' }).props.onClick())
    expect(map().props['data-crop'].id).toBe(examples.trees[1].id)
    await act(async () =>
      renderer!.root
        .findByProps({ 'data-map': 'Individual tree location map' })
        .props['data-select'](examples.trees[2].id),
    )
    expect(map().props['data-crop'].id).toBe(examples.trees[2].id)
    await act(async () =>
      renderer!.root
        .findByProps({ 'aria-label': 'Individual tree rotation' })
        .props.onChange({ target: { value: '90' } }),
    )
    expect(renderer!.root.find((n) => !!n.props['data-profile']).props['data-angle']).toBe(90)
    await select('Individual tree model', 'forainet')
    expect(map().props['data-crop'].id).toMatch(/^forainet:/)
    await select('Individual tree colours', 'semantic')
    expect(Object.values(map().props['data-labels']).every((v) => String(v).startsWith('forainet-class-'))).toBe(true)
    await act(async () =>
      renderer!.root
        .findByProps({ 'aria-label': 'Show neighbouring points' })
        .props.onChange({ target: { checked: true } }),
    )
    expect(Object.values(map().props['data-labels'])).toContain('0')
    await act(async () => renderer!.unmount())
  })
})
