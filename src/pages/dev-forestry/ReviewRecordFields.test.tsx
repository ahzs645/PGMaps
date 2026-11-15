import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { StyledSelect } from '@/components/ui/form-field'

import { KeyViewpointsSection, SubLandformFields, ViewpointRecordsSection } from './ReviewRecordFields'
import type { ViaReview } from './via'

// The (i) reads `window.matchMedia`; this renderer has no DOM, and the tip is not under test.
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))

const change = (value: string) => ({ target: { value, name: '' }, currentTarget: { value, name: '' } })
const select = (view: ReactTestRenderer, label: string) =>
  view.root.findAll((node) => node.type === StyledSelect && node.props['aria-label'] === label)[0]
const input = (view: ReactTestRenderer, label: string) =>
  view.root.findAll(
    (node) => (node.type === 'input' || node.type === 'textarea') && node.props['aria-label'] === label,
  )[0]

describe('review record fields', () => {
  it("records a saved view's Table 3 entry on the review, by the view's name, and clears an emptied field", () => {
    const patches: Partial<ViaReview>[] = []
    let review: ViaReview = {}
    const render = () => (
      <ViewpointRecordsSection
        views={['View from Hwy 16 going east']}
        review={review}
        onReviewChange={(patch) => {
          patches.push(patch)
          review = { ...review, ...patch }
        }}
      />
    )
    let view!: ReactTestRenderer
    act(() => {
      view = create(render())
    })
    act(() => select(view, 'Significance of View from Hwy 16 going east').props.onChange(change('High (5)')))
    act(() => view.update(render()))
    act(() => input(view, 'View duration from View from Hwy 16 going east').props.onChange(change('Sustained')))
    expect(review.viewpointRecords).toEqual({
      'View from Hwy 16 going east': { significance: 'High (5)', duration: 'Sustained' },
    })
    act(() => view.update(render()))
    act(() => select(view, 'Significance of View from Hwy 16 going east').props.onChange(change('')))
    act(() => view.update(render()))
    act(() => input(view, 'View duration from View from Hwy 16 going east').props.onChange(change('')))
    expect(review.viewpointRecords).toEqual({})
    // Only the review record is written: nothing the run reads.
    expect(patches.every((patch) => Object.keys(patch).join() === 'viewpointRecords')).toBe(true)
  })

  it('records a key viewpoint per block and for the group, with the reason, and goes back to the run', () => {
    let review: ViaReview = {}
    const render = () => (
      <KeyViewpointsSection
        views={['Bay', 'Ferry']}
        blocks={['X1', 'X2']}
        review={review}
        onReviewChange={(patch) => {
          review = { ...review, ...patch }
        }}
      />
    )
    let view!: ReactTestRenderer
    act(() => {
      view = create(render())
    })
    act(() => select(view, 'Key viewpoint for X1').props.onChange(change('Bay')))
    act(() => view.update(render()))
    act(() => input(view, 'Why · Key viewpoint for X1').props.onChange(change('Most used')))
    act(() => view.update(render()))
    act(() => select(view, 'Key viewpoint for the blocks together').props.onChange(change('Ferry')))
    expect(review.keyViewpoints).toEqual({
      blocks: { X1: { view: 'Bay', reason: 'Most used' } },
      group: { view: 'Ferry' },
    })
    act(() => view.update(render()))
    act(() => select(view, 'Key viewpoint for X1').props.onChange(change('')))
    act(() => view.update(render()))
    act(() => select(view, 'Key viewpoint for the blocks together').props.onChange(change('')))
    expect(review.keyViewpoints).toEqual({ blocks: {} })
  })

  it('records where a sub-landform is divided from its parent', () => {
    let review: ViaReview = {}
    const render = () => (
      <SubLandformFields
        landforms={['Landform 1b']}
        review={review}
        onReviewChange={(patch) => {
          review = { ...review, ...patch }
        }}
      />
    )
    let view!: ReactTestRenderer
    act(() => {
      view = create(render())
    })
    act(() => input(view, 'Landform Landform 1b is part of').props.onChange(change('Landform 1')))
    act(() => view.update(render()))
    act(() => input(view, 'Where Landform 1b is divided').props.onChange(change('the draw')))
    expect(review.landformRecords).toEqual({ 'Landform 1b': { parent: 'Landform 1', divider: 'the draw' } })
  })
})
