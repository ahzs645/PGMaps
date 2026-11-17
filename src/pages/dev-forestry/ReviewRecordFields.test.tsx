import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { StyledSelect } from '@/components/ui/form-field'

import {
  KeyViewpointFields,
  renamedViewpointRecords,
  SubLandformFields,
  ViewpointRecordFields,
} from './ReviewRecordFields'
import type { ViaReview } from './via'

// The (i) reads `window.matchMedia`; this renderer has no DOM, and the tip is not under test.
vi.mock('@/components/ui/info-tip', () => ({ InfoTip: () => null }))

const change = (value: string) => ({ target: { value, name: '' }, currentTarget: { value, name: '' } })
const select = (view: ReactTestRenderer, label: string) =>
  view.root.findAll((node) => node.type === StyledSelect && node.props['aria-label'] === label)[0]
const checkbox = (view: ReactTestRenderer, label: string) =>
  view.root.findAll(
    (node) => node.type === 'input' && node.props.type === 'checkbox' && node.props['aria-label'] === label,
  )[0]
const input = (view: ReactTestRenderer, label: string) =>
  view.root.findAll(
    (node) => (node.type === 'input' || node.type === 'textarea') && node.props['aria-label'] === label,
  )[0]

describe('review record fields', () => {
  it("records a saved view's Table 3 entry on the review, by the view's name, and clears an emptied field", () => {
    const patches: Partial<ViaReview>[] = []
    let review: ViaReview = {}
    const render = () => (
      <ViewpointRecordFields
        name="View from Hwy 16 going east"
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
    act(() => view.update(render()))
    act(() => select(view, 'Viewpoint type of View from Hwy 16 going east').props.onChange(change('3')))
    expect(review.viewpointRecords).toEqual({
      'View from Hwy 16 going east': { significance: 'High (5)', duration: 'Sustained', type: 3 },
    })
    act(() => view.update(render()))
    act(() => select(view, 'Viewpoint type of View from Hwy 16 going east').props.onChange(change('')))
    act(() => view.update(render()))
    act(() => select(view, 'Significance of View from Hwy 16 going east').props.onChange(change('')))
    act(() => view.update(render()))
    act(() => input(view, 'View duration from View from Hwy 16 going east').props.onChange(change('')))
    expect(review.viewpointRecords).toEqual({})
    // Only the review record is written: nothing the run reads.
    expect(patches.every((patch) => Object.keys(patch).join() === 'viewpointRecords')).toBe(true)
  })

  it("ticks a view as its block's key viewpoint and the group's, with the reason, and unticks only its own", () => {
    let review: ViaReview = { keyViewpoints: { blocks: { X2: { view: 'Ferry' } } } }
    const render = (name: string) => (
      <KeyViewpointFields
        name={name}
        blocks={['X1', 'X2']}
        group
        review={review}
        onReviewChange={(patch) => {
          review = { ...review, ...patch }
        }}
      />
    )
    let view!: ReactTestRenderer
    act(() => {
      view = create(render('Bay'))
    })
    expect(checkbox(view, 'Key viewpoint for X2: Bay').props.checked).toBe(false)
    act(() => checkbox(view, 'Key viewpoint for X1: Bay').props.onChange({ target: { checked: true } }))
    act(() => view.update(render('Bay')))
    act(() => input(view, 'Why · Key viewpoint for X1: Bay').props.onChange(change('Most used')))
    act(() => view.update(render('Bay')))
    act(() =>
      checkbox(view, 'Key viewpoint for the blocks together: Bay').props.onChange({ target: { checked: true } }),
    )
    expect(review.keyViewpoints).toEqual({
      blocks: { X1: { view: 'Bay', reason: 'Most used' }, X2: { view: 'Ferry' } },
      group: { view: 'Bay' },
    })
    // Unticking X2 from Bay's row leaves Ferry's choice alone.
    act(() => view.update(render('Bay')))
    act(() => checkbox(view, 'Key viewpoint for X2: Bay').props.onChange({ target: { checked: false } }))
    expect(review.keyViewpoints?.blocks?.X2).toEqual({ view: 'Ferry' })
    act(() => view.update(render('Bay')))
    act(() => checkbox(view, 'Key viewpoint for X1: Bay').props.onChange({ target: { checked: false } }))
    act(() => view.update(render('Bay')))
    act(() =>
      checkbox(view, 'Key viewpoint for the blocks together: Bay').props.onChange({ target: { checked: false } }),
    )
    expect(review.keyViewpoints).toEqual({ blocks: { X2: { view: 'Ferry' } } })
  })

  it("moves a renamed view's Table 3 record and key-viewpoint choices to its new name", () => {
    const review: ViaReview = {
      viewpointRecords: { Bay: { significance: 'High (5)' } },
      keyViewpoints: { blocks: { X1: { view: 'Bay', reason: 'Most used' } }, group: { view: 'Bay' } },
    }
    expect(renamedViewpointRecords(review, 'Bay', 'North bay')).toEqual({
      viewpointRecords: { 'North bay': { significance: 'High (5)' } },
      keyViewpoints: { blocks: { X1: { view: 'North bay', reason: 'Most used' } }, group: { view: 'North bay' } },
    })
    expect(renamedViewpointRecords(review, 'Ferry', 'Dock')).toBeNull()
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
