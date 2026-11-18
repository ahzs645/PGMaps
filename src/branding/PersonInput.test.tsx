import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'

import { EMPTY_PROFILE, type PreparerProfile } from './profile'

let profile: PreparerProfile | null = null
vi.mock('./useBranding', () => ({
  useBranding: () => ({ brands: [], settings: {}, logo: null, profile, ready: true, error: '' }),
}))
vi.mock('./store', () => ({ printedLogo: () => null, savePreparerProfile: vi.fn() }))
// The Your details modal, as a marker: these tests run without a DOM.
vi.mock('@/components/ui/dialog-shell', () => ({
  DialogShell: ({ open, title }: { open: boolean; title: string }) =>
    open ? <div data-testid="dialog-open">{title}</div> : null,
}))

const { PersonInput } = await import('./PersonInput')
const { PrintedPreparer, UseMyDetailsButton } = await import('./PreparerProfile')

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
  })

  it('opens Your details when none are entered, and fills nothing', () => {
    profile = null
    const applied: unknown[] = []
    const tree = create(<UseMyDetailsButton patch={{}} onApply={(p) => applied.push(p)} />)
    const button = tree.root.findAllByProps({ 'data-testid': 'use-my-details' }).find((n) => n.type === 'button')!
    expect(button.props.disabled).toBeFalsy()
    expect(JSON.stringify(tree.toJSON())).toContain('Enter your details')
    expect(tree.root.findAllByProps({ 'data-testid': 'dialog-open' })).toHaveLength(0)
    act(() => button.props.onClick())
    expect(JSON.stringify(tree.root.findByProps({ 'data-testid': 'dialog-open' }).children)).toContain('Your details')
    expect(applied).toEqual([])
  })

  it('shows one link to Your details in an output’s options, never two that open the same form', () => {
    const preparer = { printed: '', keptIn: 'FS1252 office information', patch: {}, onApply: () => {} }
    const links = (tree: ReactTestRenderer) =>
      tree.root.findAll((node) => node.type === 'button').map((node) => node.children.join(''))
    profile = null
    expect(links(create(<PrintedPreparer preparer={preparer} />))).toEqual(['Enter your details…'])
    // With details entered, one link fills this record and the other changes the details and the logo.
    profile = mine
    expect(links(create(<PrintedPreparer preparer={preparer} />))).toEqual(['Use my details', 'Edit your details'])
    // An output that prints only a logo keeps its link whether or not there are details.
    profile = null
    expect(links(create(<PrintedPreparer />))).toEqual(['Edit your details'])
  })
})
