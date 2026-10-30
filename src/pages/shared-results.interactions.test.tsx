import type { InputHTMLAttributes, ReactNode } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResultRow } from '@/components/ui/result-list'
import { AppSelect } from '@/components/ui/select'
import { MapSteppedLegend } from '@/components/ui/map-panels'
import type { CviData } from './climate-vulnerability/data'
import DevHealthMsp from './DevHealthMsp'
import DevClimateVulnerability from './DevClimateVulnerability'
import DevEarlyLearning from './DevEarlyLearning'

const fixtures = vi.hoisted(() => ({ regions: [] as unknown[] }))
vi.mock('@/lib/studyArea', () => ({ loadStudyAreaRegions: async () => fixtures.regions }))
vi.mock('@/components/ui/map', () => ({
  Map: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MapMarker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MarkerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MapControls: () => null,
  useMap: () => ({ map: null, isLoaded: false }),
}))
vi.mock('@/components/ui/map-layers', () => ({
  MapFillLayer: ({ data, selectedId }: { data: unknown; selectedId: string }) => (
    <div data-map-features={data} data-map-selected={selectedId} />
  ),
}))
vi.mock('@/components/layout/MapSectionLayout', () => ({
  MAP_SIDEBAR_CLASS: '',
  MapSectionLayout: ({
    sidebar,
    children,
    selectedFeatureMobilePeek,
  }: {
    sidebar: ReactNode
    children: ReactNode
    selectedFeatureMobilePeek?: { title: string }
  }) => (
    <main data-selected-facility={selectedFeatureMobilePeek?.title}>
      {sidebar}
      {children}
    </main>
  ),
}))
vi.mock('@/components/ui/map-panels', () => ({
  MapSidebarShell: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
  SidebarSection: ({ children, title, actions }: { children: ReactNode; title: string; actions?: ReactNode }) => (
    <section aria-label={title}>
      {actions}
      {children}
    </section>
  ),
  SearchInput: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  MapLegendPanel: ({ children, title }: { children: ReactNode; title: string }) => (
    <div aria-label={title}>{children}</div>
  ),
  MapSteppedLegend: ({ bands, variant }: { bands: unknown; variant?: string }) => (
    <div data-legend-bands={bands} data-legend-variant={variant} />
  ),
  MapLegendNote: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  FilterChipGroup: () => null,
  KeyValueRows: () => null,
  LegendItem: () => null,
  StatGrid: () => null,
  InlineAlert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/virtual-result-list', () => ({
  // Assert the page passes the complete data set to the independently tested
  // virtualizer, then exercise the page's selection/filter wiring on any row.
  VirtualResultList: <T,>({
    items,
    getKey,
    children,
    label,
  }: {
    items: T[]
    getKey: (item: T) => string
    children: (item: T) => ReactNode
    label: string
  }) => (
    <div aria-label={label} data-result-count={items.length}>
      {items.map((item) => (
        <div key={getKey(item)}>{children(item)}</div>
      ))}
    </div>
  ),
}))
vi.mock('@/components/ui/timeline', () => ({ Timeline: () => null }))
vi.mock('@/components/ui/map-popup-card', () => ({
  MapPopupCard: ({ children, title }: { children: ReactNode; title: string }) => (
    <div aria-label={title}>{children}</div>
  ),
}))
vi.mock('@/components/ui/select', () => ({ AppSelect: () => null }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('shared searchable result integrations', () => {
  it('makes every MSP match available beyond the former 80-row cap and keeps filtering and selection', async () => {
    const features = Array.from({ length: 105 }, (_, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-123, 54] },
      properties: {
        id: String(index),
        payeeName: `Facility ${index}`,
        payeeType: 'hospital',
        firstFiscalStartYear: 2023,
        latestFiscalStartYear: 2024,
        totalAmount: 100,
        maxAnnualAmount: 100,
        averageAnnualAmount: 100,
        annualPayments: [
          { fiscalStartYear: 2023, fiscalYear: '2023/2024', amount: 50 },
          { fiscalStartYear: 2024, fiscalYear: '2024/2025', amount: 100 },
        ],
        matchedLocality: 'Prince George',
        matchMethod: 'name',
        matchScore: 1,
      },
    }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ type: 'FeatureCollection', features }))),
    )
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<DevHealthMsp />)
    })
    expect(renderer!.root.findByProps({ 'aria-label': 'MSP facilities' }).props['data-result-count']).toBe(105)
    const last = renderer!.root.findAllByType(ResultRow).find((row) => row.props.title === 'Facility 104')!
    await act(async () => last.props.onClick())
    expect(renderer!.root.findByType('main').props['data-selected-facility']).toBe('Facility 104')
    expect(
      renderer!.root.findAllByType(ResultRow).find((row) => row.props.title === 'Facility 104')!.props.selected,
    ).toBe(true)
    await act(async () =>
      renderer!.root.findByProps({ id: 'msp-search' }).props.onChange({ target: { value: 'Facility 104' } }),
    )
    expect(renderer!.root.findByProps({ 'aria-label': 'MSP facilities' }).props['data-result-count']).toBe(1)
    expect(renderer!.root.findByType(ResultRow).props.subtitle).toBe('Prince George · $150')
    await act(async () => renderer!.root.findByProps({ title: 'Show timeline' }).props.onClick())
    expect(renderer!.root.findByType(ResultRow).props.subtitle).toBe('Prince George · $100')
    await act(async () => renderer!.root.findByType(AppSelect).props.onValueChange('2023'))
    expect(renderer!.root.findByType(ResultRow).props.subtitle).toBe('Prince George · $50')
    await act(async () => renderer!.unmount())
  })

  it('keeps tied quantile boundaries and non-geometric FSA rows when adopting shared climate results and legends', async () => {
    const field = 'pm25_fsa_avg10yr_2020'
    const values = [0, 0, 0, 0, 1, 1, 1, 1, 10, 10]
    const rows = values.map((value, index) => ({
      fsa: `A${index}`,
      name: `Area ${index}`,
      mapped: true,
      values: { [field]: value },
    }))
    rows.push({ fsa: 'V7X', name: 'No polygon source row', mapped: false, values: { [field]: 80 } })
    const data = {
      variables: [
        {
          catalogueId: 1,
          field,
          label: 'PM2.5',
          available: true,
          reportComponent: 'Exposure',
          selection: 'selected',
          candidateDatasets: [],
        },
      ],
      rows,
      summary: { missingSelected: [] },
      cautions: [],
    } as unknown as CviData
    fixtures.regions = rows
      .filter((row) => row.mapped)
      .map((row) => ({
        code: row.fsa,
        name: row.name,
        bounds: [-123, 53, -122, 54],
        feature: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [] }, properties: {} },
      }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(data))),
    )
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <DevClimateVulnerability />
        </MemoryRouter>,
      )
    })
    // The original cut convention is [lower, upper), with equality assigned
    // to the next band by the unchanged MapLibre step expression.
    const legend = renderer!.root.findAllByType(MapSteppedLegend).find((node) => node.props.variant === 'rows')!
    expect(legend.props.bands.map((band: { label: string }) => band.label)).toEqual([
      '< 0.6',
      '0.6 – < 1',
      '1 – < 2.8',
      '≥ 2.8',
    ])
    expect(renderer!.root.findByProps({ 'aria-label': 'Climate vulnerability FSAs' }).props['data-result-count']).toBe(
      11,
    )
    const unmapped = renderer!.root.findAllByType(ResultRow).find((row) => row.props.trailing === '80')!
    expect(unmapped.props.meta).toBeTruthy()
    await act(async () => unmapped.props.onClick())
    expect(renderer!.root.findByProps({ 'data-map-selected': 'V7X' })).toBeTruthy()
    await act(async () =>
      renderer!.root.findByProps({ id: 'cvi-fsa-search' }).props.onChange({ target: { value: 'No polygon' } }),
    )
    expect(renderer!.root.findByProps({ 'aria-label': 'Climate vulnerability FSAs' }).props['data-result-count']).toBe(
      1,
    )
    // Filtering the list does not alter the calculation population or legend.
    expect(
      renderer!.root.findAllByType(MapSteppedLegend).find((node) => node.props.variant === 'rows')!.props.bands,
    ).toEqual(legend.props.bands)
    await act(async () => renderer!.unmount())
  })

  it('clears stale early-learning results while loading a different source and retains suppressed values', async () => {
    const releaseId = 'a'.repeat(64)
    const dataset = (id: string) => ({
      id,
      label: id,
      source: 'https://example.test',
      waves: [9],
      measures: [{ id: 'pct_overall_vulnerable', label: 'Overall vulnerable', unit: 'percent' }],
      families: { GEOSD: { path: `${id}.json` } },
      notes: '',
    })
    const manifest = {
      releaseId,
      families: { GEOSD: 'School districts' },
      datasets: [dataset('source-a'), dataset('source-b')],
      boundaries: [],
      gaps: [],
    }
    let resolveSourceA: (value: Response) => void = () => undefined
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith(`releases/${releaseId}.json`)) return new Response(JSON.stringify(manifest))
      if (url.endsWith('source-a.json'))
        return new Promise<Response>((resolve) => {
          resolveSourceA = resolve
        })
      return new Response(
        JSON.stringify({
          regions: [
            {
              id: 'GEOSD_57',
              name: 'Original area',
              observations: [{ wave: 9, measure: 'pct_overall_vulnerable', value: 20, status: 'published' }],
            },
          ],
        }),
      )
    })
    vi.stubGlobal('fetch', fetch)
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <MemoryRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          initialEntries={[`/?release=${releaseId}`]}
        >
          <DevEarlyLearning />
        </MemoryRouter>,
      )
    })
    expect(renderer!.root.findByProps({ 'aria-label': 'Early development areas' }).props['data-result-count']).toBe(1)
    expect(renderer!.root.findByType(ResultRow).props.title).toBe('Original area')
    await act(async () =>
      renderer!.root
        .findByProps({ 'aria-label': 'EDI source release' })
        .props.onChange({ target: { value: 'source-a' } }),
    )
    expect(renderer!.root.findAllByType(ResultRow)).toHaveLength(0)
    await act(async () =>
      resolveSourceA(
        new Response(
          JSON.stringify({
            regions: [
              {
                id: 'GEOSD_57',
                name: 'New source area',
                observations: [{ wave: 9, measure: 'pct_overall_vulnerable', value: null, status: 'suppressed' }],
              },
            ],
          }),
        ),
      ),
    )
    expect(renderer!.root.findByType(ResultRow).props.title).toBe('New source area')
    expect(renderer!.root.findByType(ResultRow).props.trailing).toBe('Not reported / suppressed')
    expect(fetch.mock.calls[0][0]).toBe(`/__dev_early_learning/releases/${releaseId}.json`)
    await act(async () => renderer!.unmount())
  })
  it('does not request or show local EDI data outside development mode', async () => {
    vi.stubEnv('DEV', false)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    let renderer: ReturnType<typeof create>
    await act(async () => {
      renderer = create(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <DevEarlyLearning />
        </MemoryRouter>,
      )
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(renderer!.root.findAllByType(ResultRow)).toHaveLength(0)
    expect(JSON.stringify(renderer!.toJSON())).toContain('This review is available in the local development server.')
    await act(async () => renderer!.unmount())
  })
})
