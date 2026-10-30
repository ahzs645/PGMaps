import { readFileSync } from 'node:fs'
import { useState } from 'react'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { InventoryDetail } from './InventoryDetail'
import { treeEstimate } from './summary'
import { DEFAULT_RULES, EMPTY_REVIEW, type InventoryData, type TreeReview } from './types'

const data: InventoryData = JSON.parse(readFileSync(new URL('./inventory.generated.json', import.meta.url), 'utf8'))
const tree = data.crowns.features[0]

describe('inventory DBH review field', () => {
  it('retains the original positive-value guard and clears an observation to null', () => {
    const onReview = vi.fn()
    function Review() {
      const [review, setReview] = useState<TreeReview>({ ...EMPTY_REVIEW, dbh_cm: 20 })
      return (
        <InventoryDetail
          row={treeEstimate(tree, DEFAULT_RULES, { [tree.properties.id]: review })}
          onReview={(patch) => {
            onReview(patch)
            setReview((current) => ({ ...current, ...patch }))
          }}
        />
      )
    }
    let view: ReturnType<typeof create>
    act(() => {
      view = create(<Review />)
    })
    try {
      const input = () =>
        view!.root.findAllByType('input').find((node) => node.props['aria-label'] === 'Inventory entered DBH')!
      expect(input().props.className).toBe('mt-1 w-full rounded border bg-background p-1.5')
      // min/step remain browser hints; the original source guard accepted every positive value up to 500.
      act(() => input().props.onChange({ target: { value: '0.05' } }))
      expect(onReview).toHaveBeenLastCalledWith({ dbh_cm: 0.05 })
      onReview.mockClear()
      for (const value of ['0', '-1', '501']) {
        act(() => input().props.onChange({ target: { value } }))
        expect(onReview).not.toHaveBeenCalled()
      }
      act(() => input().props.onChange({ target: { value: '' } }))
      expect(onReview).toHaveBeenLastCalledWith({ dbh_cm: null })
      expect(input().props.value).toBe('')
    } finally {
      act(() => view!.unmount())
    }
  })

  it('retains source precision when the reviewer does not edit the value', () => {
    const onReview = vi.fn()
    const dbh = 21.123456789
    const row = treeEstimate(tree, DEFAULT_RULES, { [tree.properties.id]: { ...EMPTY_REVIEW, dbh_cm: dbh } })
    let view: ReturnType<typeof create>
    act(() => {
      view = create(<InventoryDetail row={row} onReview={onReview} />)
    })
    try {
      const input = view!.root
        .findAllByType('input')
        .find((node) => node.props['aria-label'] === 'Inventory entered DBH')!
      expect(input.props.value).toBe(String(dbh))
      act(() => input.props.onBlur())
      expect(onReview).not.toHaveBeenCalled()
    } finally {
      act(() => view!.unmount())
    }
  })
})
