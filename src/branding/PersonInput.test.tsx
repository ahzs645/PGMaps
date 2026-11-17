import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { EMPTY_PROFILE, type PreparerProfile } from './profile'

let profile: PreparerProfile | null = null
vi.mock('./useBranding', () => ({
  useBranding: () => ({ brands: [], settings: {}, logo: null, profile, ready: true, error: '' }),
}))
vi.mock('./store', () => ({ printedLogo: () => null, savePreparerProfile: vi.fn() }))

const { PersonInput } = await import('./PersonInput')
const { UseMyDetailsButton } = await import('./PreparerProfile')

const mine: PreparerProfile = { ...EMPTY_PROFILE, name: 'J. Smith', designation: 'RPF', registration: '4521' }
const useMine = (tree: ReactTestRenderer) => tree.root.findAllByProps({ 'data-testid': 'person-input-use-mine' })

describe('a person field', () => {
  it('offers your name only when Your details has one', () => {
    profile = null
    const tree = create(<PersonInput value="" onValueChange={() => {}} />)
    expect(useMine(tree)).toHaveLength(0)
  })

  it('fills your name on a click, offers to replace someone else’s, and stays quiet once it is yours', () => {
    profile = mine
    const changes: string[] = []
    const tree = create(<PersonInput value="" onValueChange={(value) => changes.push(value)} />)
    const button = useMine(tree).find((node) => typeof node.type !== 'string')!
    expect(JSON.stringify(tree.toJSON())).toContain('Use mine (J. Smith)')
    act(() => button.props.onClick({ preventDefault() {} }))
    expect(changes).toEqual(['J. Smith'])

    act(() => tree.update(<PersonInput value="A. Other" onValueChange={() => {}} />))
    expect(JSON.stringify(tree.toJSON())).toContain('Use mine instead (J. Smith)')
    act(() => tree.update(<PersonInput value="J. Smith" onValueChange={() => {}} />))
    expect(useMine(tree)).toHaveLength(0)
    act(() => tree.update(<PersonInput value="" withDesignation onValueChange={() => {}} />))
    expect(JSON.stringify(tree.toJSON())).toContain('Use mine (J. Smith, RPF #4521)')
  })
})

describe('Use my details', () => {
  it('writes the patch on a click, and says why when there is nothing to write', () => {
    profile = mine
    const applied: unknown[] = []
    const tree = create(<UseMyDetailsButton patch={{ preparedBy: 'J. Smith' }} onApply={(p) => applied.push(p)} />)
    const button = tree.root.findAllByProps({ 'data-testid': 'use-my-details' }).find((n) => n.type === 'button')!
    act(() => button.props.onClick())
    expect(applied).toEqual([{ preparedBy: 'J. Smith' }])

    act(() => tree.update(<UseMyDetailsButton patch={{}} onApply={() => {}} />))
    expect(JSON.stringify(tree.toJSON())).toContain('already filled')
    profile = null
    act(() => tree.update(<UseMyDetailsButton patch={{}} onApply={() => {}} />))
    expect(JSON.stringify(tree.toJSON())).toContain('Enter your details first')
  })
})
