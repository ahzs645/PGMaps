import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BcAccessDiscoveryPanel } from './BcAccessDiscoveryPanel'
import * as searchSource from './bcAccessSearch'
import { Field } from './Controls'

vi.mock('./Controls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./Controls')>()),
  RoadSelect: (await import('./roadSelectTestDouble')).RoadSelectTestDouble,
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children }: { children: ReactNode }) => createElement('aside', {}, children),
}))
vi.mock('@/components/ui/map-panels', () => ({
  InlineAlert: ({ children, title }: { children: ReactNode; title?: string }) =>
    createElement('div', { role: 'alert' }, title, children),
}))

const views: ReactTestRenderer[] = []
afterEach(async () => {
  for (const view of views.splice(0)) await act(async () => view.unmount())
  vi.restoreAllMocks()
})

const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')

function button(view: ReactTestRenderer, label: string) {
  const found = view.root
    .findAllByType('button')
    .find((node) => node.props['aria-label'] === label || text(node) === label)
  if (!found) throw Error(`Missing button: ${label}`)
  return found
}

function field(view: ReactTestRenderer, label: string) {
  return view.root
    .findAllByType(Field)
    .find((node) => node.props.label === label)!
    .findByType('input')
}

function result(
  openingId = '99001',
  options: Partial<searchSource.BcCutblockSearchResult> = {},
): searchSource.BcCutblockSearchResult {
  return {
    records: [
      {
        id: `fixture:${openingId}`,
        openingId,
        cutblockSKey: `fixture-key-${openingId}`,
        forestFileId: 'TEST-LICENCE',
        cuttingPermitId: '04',
        cutBlockId: '2',
        timberMark: 'TEST-MARK',
        clientNumber: '00009999',
        lifecycleStatus: 'ACTIVE',
        disturbanceStartDate: '2001-04-01',
        disturbanceEndDate: '2002-03-30',
        bounds: [-123, 54, -122.999, 54.001],
      },
    ],
    query: {
      filters: { openingId, limit: 25 },
      requestUrl: 'https://example.invalid/fixture-query',
      retrievedAt: '2026-11-09T12:00:00Z',
      sourceUrl: 'https://example.invalid/fixture-source',
      limit: 25,
    },
    returnedCount: 1,
    hasMore: false,
    matchedCountLowerBound: 1,
    ...options,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

async function harness(onOpenStudy = vi.fn<(_: string) => Promise<void>>().mockResolvedValue(undefined)) {
  let view!: ReactTestRenderer
  await act(async () => {
    view = create(createElement(BcAccessDiscoveryPanel, { onOpenStudy }))
  })
  views.push(view)
  return { view, onOpenStudy }
}

async function enterOpening(view: ReactTestRenderer, openingId = '99001') {
  await act(async () => field(view, 'Opening ID').props.onChange({ target: { value: openingId } }))
}

async function submit(view: ReactTestRenderer) {
  await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() }))
}

describe('BC cutblock discovery', () => {
  it('searches combined exact identifiers and opens only the explicitly selected result', async () => {
    const lookup = vi.spyOn(searchSource, 'searchBcCutblocks').mockResolvedValue(result())
    const { view, onOpenStudy } = await harness()
    expect(button(view, 'Search BC cutblocks').props.disabled).toBe(true)
    await enterOpening(view, ' 99001 ')
    await act(async () => field(view, 'Forest licence').props.onChange({ target: { value: ' TEST-LICENCE ' } }))
    await submit(view)
    expect(lookup.mock.calls[0][0]).toEqual({ openingId: '99001', forestFileId: 'TEST-LICENCE', limit: 25 })
    expect(lookup.mock.calls[0][1]).toBeInstanceOf(AbortSignal)
    expect(onOpenStudy).not.toHaveBeenCalled()
    expect(text(view.root)).toContain('2001-04-01')
    expect(text(view.root)).toContain('Completion (may be estimated)2002-03-30')
    expect(text(view.root)).toContain('Administrative statusACTIVE')
    await act(async () => button(view, 'Open study for opening 99001, cutblock 2').props.onClick())
    expect(onOpenStudy).toHaveBeenCalledExactlyOnceWith('99001')
  })

  it('cancels an in-flight search and ignores a late response even if the transport ignores abort', async () => {
    const pending = deferred<searchSource.BcCutblockSearchResult>()
    const lookup = vi.spyOn(searchSource, 'searchBcCutblocks').mockReturnValue(pending.promise)
    const { view } = await harness()
    await enterOpening(view)
    await submit(view)
    const signal = lookup.mock.calls[0][1]!
    await act(async () => button(view, 'Cancel search').props.onClick())
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(result()))
    expect(text(view.root)).toContain('Search cancelled')
    expect(view.root.findAllByProps({ 'data-testid': 'bc-cutblock-search-results' })).toHaveLength(0)
    expect(button(view, 'Search BC cutblocks').props.disabled).toBe(false)
  })

  it('invalidates a previous query on edits and prevents an old result from replacing a newer one', async () => {
    const first = deferred<searchSource.BcCutblockSearchResult>()
    const lookup = vi
      .spyOn(searchSource, 'searchBcCutblocks')
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(result('99002'))
    const { view } = await harness()
    await enterOpening(view)
    await submit(view)
    await enterOpening(view, '99002')
    expect(lookup.mock.calls[0][1]!.aborted).toBe(true)
    await submit(view)
    await act(async () => first.resolve(result('99001')))
    expect(text(view.root)).toContain('Opening 99002')
    expect(text(view.root)).not.toContain('Opening 99001')
    await act(async () => field(view, 'Timber mark').props.onChange({ target: { value: 'OTHER-MARK' } }))
    expect(view.root.findAllByProps({ 'data-testid': 'bc-cutblock-search-results' })).toHaveLength(0)
  })

  it('aborts when a containing view is hidden and starts a usable fresh search on return', async () => {
    const pending = deferred<searchSource.BcCutblockSearchResult>()
    const lookup = vi.spyOn(searchSource, 'searchBcCutblocks').mockReturnValue(pending.promise)
    const { view, onOpenStudy } = await harness()
    await enterOpening(view)
    await submit(view)
    await act(async () => view.update(createElement(BcAccessDiscoveryPanel, { onOpenStudy, active: false })))
    expect(lookup.mock.calls[0][1]!.aborted).toBe(true)
    await act(async () => pending.resolve(result()))
    await act(async () => view.update(createElement(BcAccessDiscoveryPanel, { onOpenStudy, active: true })))
    await enterOpening(view, '99002')
    expect(button(view, 'Search BC cutblocks').props.disabled).toBe(false)
    expect(view.root.findAllByProps({ 'data-testid': 'bc-cutblock-search-results' })).toHaveLength(0)
  })

  it('distinguishes a failed query from a successful search with no records', async () => {
    vi.spyOn(searchSource, 'searchBcCutblocks')
      .mockRejectedValueOnce(Error('Source request timed out.'))
      .mockResolvedValueOnce(result('99001', { records: [], returnedCount: 0, matchedCountLowerBound: 0 }))
    const { view } = await harness()
    await enterOpening(view)
    await submit(view)
    expect(text(view.root)).toContain('Source request timed out.')
    expect(text(view.root)).not.toContain('No FTEN cutblock records matched')
    await submit(view)
    expect(text(view.root)).toContain('No FTEN cutblock records matched')
    expect(text(view.root)).toContain('This does not establish that no historical block existed.')
    expect(text(view.root)).not.toContain('Source request timed out.')
  })

  it('keeps results and allows retry after opening fails, without duplicate simultaneous loads', async () => {
    vi.spyOn(searchSource, 'searchBcCutblocks').mockResolvedValue(result())
    const opening = deferred<void>()
    const onOpenStudy = vi
      .fn<(_: string) => Promise<void>>()
      .mockReturnValueOnce(opening.promise)
      .mockResolvedValueOnce(undefined)
    const { view } = await harness(onOpenStudy)
    await enterOpening(view)
    await submit(view)
    const open = button(view, 'Open study for opening 99001, cutblock 2')
    await act(async () => {
      open.props.onClick()
      open.props.onClick()
    })
    expect(onOpenStudy).toHaveBeenCalledTimes(1)
    await act(async () => opening.reject(Error('Terrain service unavailable.')))
    expect(text(view.root)).toContain('Could not open study for opening 99001. Terrain service unavailable.')
    expect(text(view.root)).toContain('FTEN cutblock record fixture-key-99001')
    expect(button(view, 'Open study for opening 99001, cutblock 2').props.disabled).toBe(false)
    await act(async () => button(view, 'Open study for opening 99001, cutblock 2').props.onClick())
    expect(onOpenStudy).toHaveBeenCalledTimes(2)
    expect(text(view.root)).not.toContain('Terrain service unavailable.')
  })

  it('retains incomplete and unsupported source IDs with a clear unavailable action and honest cap notice', async () => {
    const base = result()
    vi.spyOn(searchSource, 'searchBcCutblocks').mockResolvedValue(
      result('99001', {
        records: [
          ...base.records,
          {
            ...base.records[0],
            id: 'negative',
            openingId: null,
            reportedOpeningId: '-123',
            cutblockSKey: 'negative-key',
          },
          { ...base.records[0], id: 'missing-geometry', openingId: '99003', bounds: null },
        ],
        returnedCount: 3,
        hasMore: true,
        matchedCountLowerBound: 4,
      }),
    )
    const opening = deferred<void>()
    const { view } = await harness(vi.fn<(_: string) => Promise<void>>().mockReturnValue(opening.promise))
    await enterOpening(view)
    await submit(view)
    expect(text(view.root)).toContain('Reported opening -123')
    expect(text(view.root)).toContain('A positive opening ID is required')
    expect(text(view.root)).toContain('No polygon geometry was returned')
    expect(text(view.root)).toContain('Showing the first 3 records')
    expect(text(view.root)).toContain('This is not a complete inventory.')
    const unavailable = button(view, 'Study unavailable for opening -123, cutblock 2')
    expect(unavailable.props.disabled).toBe(true)
    expect(text(unavailable)).toBe('Study unavailable')
    expect(button(view, 'Study unavailable for opening 99003, cutblock 2').props.disabled).toBe(true)
    expect(view.root.findAllByProps({ 'data-cutblock-record': 'negative' })).toHaveLength(1)
    expect(text(view.root)).not.toContain('Opening study…')
    await act(async () => button(view, 'Open study for opening 99001, cutblock 2').props.onClick())
    expect(text(button(view, 'Open study for opening 99001, cutblock 2'))).toBe('Opening study…')
    expect(text(button(view, 'Study unavailable for opening -123, cutblock 2'))).toBe('Study unavailable')
    await act(async () => opening.resolve(undefined))
    expect(text(view.root)).not.toContain('Opening study…')
  })
})
