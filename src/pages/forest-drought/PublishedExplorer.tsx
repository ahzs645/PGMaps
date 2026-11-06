import { useEffect, useId, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Download, Link2, RefreshCw } from 'lucide-react'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { FormField, NativeSelect, SelectField } from '@/components/ui/form-field'
import { InlineAlert, SearchInput } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { ExternalLink } from '@/components/ui/text-button'
import { downloadText } from '@/lib/download'
import {
  PUBLISHED_PERIODS,
  PUBLISHED_SOURCE,
  RISK_LEVELS,
  SOIL_MOISTURE_REGIMES,
  TREE_SPECIES,
  exportPublishedCsv,
  filterPublishedRows,
  parsePublishedCsv,
  publishedSeries,
  type PublishedDataset,
  type PublishedPeriod,
  type RiskCode,
  type SoilMoistureRegime,
  type SpeciesCode,
} from '@/features/forest-drought/published'
import { parsePublishedSelection } from './query'

const RISK_TONES: Record<RiskCode, BadgeTone> = { L: 'success', M: 'warning', H: 'orange', VH: 'danger' }
const riskLabel = (code: RiskCode) => RISK_LEVELS.find((item) => item.code === code)?.label ?? code
const assetPath = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
// Include the scientific source revision in the service worker's cache key.
// An older cached CSV must not shadow a newly pinned dataset on first load.
const publishedCsvUrl = `${assetPath(PUBLISHED_SOURCE.csvPath)}?v=${PUBLISHED_SOURCE.sha256}`

function RiskBadge({ risk }: { risk: RiskCode }) {
  return (
    <Badge tone={RISK_TONES[risk]} size="sm">
      {riskLabel(risk)}
    </Badge>
  )
}

export function PublishedExplorer({ active }: { active: boolean }) {
  const { search: querySearch } = useLocation()
  const initialSelection = parsePublishedSelection(querySearch)
  const requestedBgc = initialSelection.bgc
  const [dataset, setDataset] = useState<PublishedDataset | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const [chosenBgc, setBgc] = useState<string | null>(null)
  const bgc = chosenBgc ?? (dataset?.bgcUnits.includes(requestedBgc) ? requestedBgc : '')
  const [smr, setSmr] = useState<SoilMoistureRegime | ''>(initialSelection.smr)
  const [period, setPeriod] = useState<PublishedPeriod | ''>(initialSelection.period)
  const [species, setSpecies] = useState<SpeciesCode | 'all'>('all')
  const bgcId = useId()

  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(
      () =>
        controller.abort(
          new Error('Published data took longer than 30 seconds to load. Check your connection and retry.'),
        ),
      30_000,
    )
    let alive = true
    void fetch(publishedCsvUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Published data could not load (HTTP ${response.status}).`)
        if (!globalThis.crypto?.subtle)
          throw new Error('Checking the published data requires a secure browser context. Use HTTPS or localhost.')
        const bytes = await response.arrayBuffer()
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
        if (hash !== PUBLISHED_SOURCE.sha256) {
          // The service worker caches any 200 response for this URL. Drop a corrupt copy so the
          // retry fetches the network instead of waiting for background revalidation.
          await globalThis.caches
            ?.open('pgmaps-data-v1')
            .then((cache) => cache.delete(publishedCsvUrl))
            .catch(() => undefined)
          throw new Error(
            'The published table does not match its pinned source checksum. Results have been withheld; reload or report this data-version mismatch.',
          )
        }
        const parsed = parsePublishedCsv(new TextDecoder().decode(bytes))
        if (alive) {
          setDataset(parsed)
          setError('')
        }
      })
      .catch((cause: unknown) => {
        if (alive) setError(cause instanceof Error ? cause.message : 'Published data could not load.')
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      alive = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [attempt])

  const matchingBgc = useMemo(
    () => dataset?.bgcUnits.filter((unit) => unit.toLowerCase().includes(search.trim().toLowerCase())) ?? [],
    [dataset, search],
  )
  const series = useMemo(
    () => (dataset && bgc && smr !== '' ? publishedSeries(dataset, bgc, smr) : []),
    [dataset, bgc, smr],
  )
  const current = series.find((row) => row.period === period)
  const allSoils = dataset && bgc && period ? filterPublishedRows(dataset, { bgc, period }) : []
  const soilLabel = SOIL_MOISTURE_REGIMES.find((soil) => soil.id === smr)?.label
  const periodDetails = PUBLISHED_PERIODS.find((item) => item.id === period)
  const shownSpecies = TREE_SPECIES.filter((tree) => species === 'all' || tree.code === species)
  const chartData = series.map((row) => ({ period: row.period, value: row.aetPet }))
  const exportSelection = () => {
    downloadText(exportPublishedCsv(series), `fordrat-${bgc}-smr-${smr}-all-periods.csv`, 'text/csv;charset=utf-8')
  }
  const selectionLink = () => {
    const url = new URL(window.location.href)
    url.search = new URLSearchParams({ bgc, smr: String(smr), period }).toString()
    url.hash = ''
    return url.href
  }

  return (
    <div className="space-y-6">
      <InlineAlert title="Published forDRAT results">
        Province of British Columbia · BEC version 11 · mature stands and interior species. These are regional
        drought-risk estimates, not species suitability or planting recommendations. The site’s soil moisture regime
        must be assessed separately.
      </InlineAlert>

      {error && (
        <InlineAlert tone="error" title="Published estimates unavailable">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => {
              setError('')
              setAttempt((value) => value + 1)
            }}
          >
            <RefreshCw aria-hidden="true" /> Retry data load
          </Button>
        </InlineAlert>
      )}
      {!dataset && !error && <InlineAlert loading>Loading and checking the published table…</InlineAlert>}
      {dataset && chosenBgc === null && initialSelection.issues.bgc && (
        <InlineAlert tone="warning">{initialSelection.issues.bgc}</InlineAlert>
      )}
      {dataset && chosenBgc === null && requestedBgc && !bgc && (
        <InlineAlert tone="warning" className="break-words">
          The linked BGC identifier “{requestedBgc}” is not an exact match in this BEC v11 table. Select a published
          unit below.
        </InlineAlert>
      )}

      {dataset && (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]">
            <section
              aria-labelledby="drought-selection-title"
              className="min-w-0 space-y-5 self-start rounded-xl border bg-background p-4 sm:p-5"
            >
              <div>
                <h2 id="drought-selection-title" className="text-base font-semibold">
                  Choose a site context
                </h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  All {dataset.bgcUnits.length} published BGC units are available.
                </p>
              </div>
              <FormField label="Find a BGC unit" htmlFor={`${bgcId}-search`}>
                <SearchInput
                  id={`${bgcId}-search`}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onClear={() => setSearch('')}
                  placeholder="For example, SBS or IDF"
                  data-map-search-input="false"
                />
              </FormField>
              <FormField
                label="BGC unit (BEC v11)"
                description={`${matchingBgc.length} matching units. Search does not change a selected unit.`}
              >
                <NativeSelect value={bgc} onChange={(event) => setBgc(event.target.value)}>
                  <option value="">Select a BGC unit…</option>
                  {bgc && !matchingBgc.includes(bgc) && <option value={bgc}>{bgc} (selected)</option>}
                  {matchingBgc.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </NativeSelect>
              </FormField>
              <SelectField
                label="Soil moisture regime"
                error={smr === '' ? initialSelection.issues.smr : undefined}
                value={smr}
                onChange={(event) =>
                  setSmr(event.target.value ? (Number(event.target.value) as SoilMoistureRegime) : '')
                }
                description="Choose an assessed regime or explicitly explore a hypothetical one. It is not inferred from BGC."
              >
                <option value="">Select a soil moisture regime…</option>
                {SOIL_MOISTURE_REGIMES.map((soil) => (
                  <option key={soil.id} value={soil.id}>
                    {soil.id} · {soil.label}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Focus period"
                error={period === '' ? initialSelection.issues.period : undefined}
                value={period}
                onChange={(event) => setPeriod(event.target.value as PublishedPeriod | '')}
              >
                <option value="">Select a published period…</option>
                {PUBLISHED_PERIODS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Species comparison"
                value={species}
                onChange={(event) => setSpecies(event.target.value as SpeciesCode | 'all')}
              >
                <option value="all">All ten species</option>
                {TREE_SPECIES.map((tree) => (
                  <option key={tree.code} value={tree.code}>
                    {tree.code} · {tree.name}
                  </option>
                ))}
              </SelectField>
              <div className="space-y-2 border-t pt-4">
                <Button variant="outline" size="sm" className="w-full" disabled={!current} onClick={exportSelection}>
                  <Download aria-hidden="true" /> Download selected site CSV
                </Button>
                <Button variant="ghost" size="sm" asChild className="w-full">
                  <a href={publishedCsvUrl} download="fordrat-published-original.csv">
                    Original published CSV
                  </a>
                </Button>
                <CopyButton
                  text={selectionLink}
                  disabled={!current}
                  className={`${buttonVariants({ variant: 'ghost', size: 'sm' })} w-full`}
                >
                  <Link2 aria-hidden="true" /> Copy selection link
                </CopyButton>
              </div>
            </section>

            <div className="min-w-0 space-y-5">
              {!current ? (
                <section className="flex min-h-64 flex-col justify-center rounded-xl border border-dashed bg-background/60 p-6 text-center">
                  <h2 className="text-lg font-semibold">
                    {period === '' ? 'Choose a published climate period' : 'Choose a BGC unit and soil regime'}
                  </h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                    See the water-balance estimate and ten species’ risk ratings across all six published periods. No
                    soil regime is assumed for your site.
                  </p>
                  <div className="mt-6">
                    <StatGroup
                      variant="inline"
                      items={[
                        { label: 'BGC units', value: dataset.bgcUnits.length },
                        { label: 'Soil regimes', value: 5 },
                        { label: 'Periods', value: 6 },
                      ]}
                    />
                  </div>
                </section>
              ) : (
                <>
                  <section
                    className="rounded-xl border bg-background p-4 sm:p-5"
                    aria-labelledby="drought-results-title"
                  >
                    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 id="drought-results-title" className="text-xl font-semibold">
                          {bgc} · {soilLabel}
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">{periodDetails?.label}</p>
                      </div>
                      <Badge tone={periodDetails?.kind === 'projection' ? 'violet' : 'info'} size="sm">
                        {periodDetails?.kind === 'projection' ? 'RCP4.5 ensemble' : 'Historical climate'}
                      </Badge>
                    </div>
                    <StatGroup
                      variant="tiles"
                      items={[
                        { label: 'AET / PET', value: current.aetPet.toFixed(3), note: 'Published soil water ratio' },
                        {
                          label: 'Soil regime',
                          value: `${smr} · ${soilLabel}`,
                          compact: true,
                          note: 'Your selected site context',
                        },
                        { label: 'Species compared', value: shownSpecies.length, note: 'Drought response only' },
                      ]}
                    />
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      AET/PET compares actual and potential evapotranspiration. Lower values indicate a larger water
                      deficit. All species at this soil regime share this ratio; their published risk ratings differ.
                    </p>
                  </section>

                  <section
                    className="rounded-xl border bg-background p-4 sm:p-5"
                    aria-labelledby="drought-period-chart-title"
                  >
                    <h3 id="drought-period-chart-title" className="font-semibold">
                      Water balance across periods
                    </h3>
                    <p className="mb-4 mt-1 text-xs leading-5 text-muted-foreground">
                      Historical normals overlap. Projected normals are separate climate scenarios, not annual
                      observations.
                    </p>
                    {active && (
                      <div
                        className="h-60 w-full min-w-0"
                        role="img"
                        aria-label="Bar chart of published AET/PET across six periods; exact values are in the comparison table below."
                      >
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                          <BarChart data={chartData} margin={{ top: 8, right: 4, bottom: 16, left: -20 }}>
                            <CartesianGrid
                              strokeDasharray="3 3"
                              vertical={false}
                              stroke="currentColor"
                              opacity={0.12}
                            />
                            <XAxis
                              dataKey="period"
                              tick={{ fontSize: 10, fill: 'currentColor' }}
                              interval={0}
                              angle={-20}
                              height={42}
                            />
                            <YAxis
                              domain={[0, 1]}
                              tick={{ fontSize: 11, fill: 'currentColor' }}
                              ticks={[0, 0.25, 0.5, 0.75, 1]}
                            />
                            <Tooltip
                              formatter={(value) => [String(Number(value)), 'AET/PET']}
                              contentStyle={{
                                background: 'hsl(var(--background))',
                                color: 'hsl(var(--foreground))',
                                borderRadius: 8,
                              }}
                            />
                            <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                              {chartData.map((item, index) => (
                                <Cell
                                  key={item.period}
                                  fill={item.period === period ? '#047857' : index < 3 ? '#94a3b8' : '#a78bfa'}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          </div>

          {current && (
            <section
              className="min-w-0 overflow-hidden rounded-xl border bg-background"
              aria-labelledby="drought-species-title"
            >
              <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
                <div>
                  <h2 id="drought-species-title" className="text-lg font-semibold">
                    Species risk across all periods
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {bgc} · {soilLabel}. Ratings retain the published values. Presence in this table does not establish
                    local occurrence.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5" aria-label="Drought risk legend">
                  {RISK_LEVELS.map((level) => (
                    <RiskBadge key={level.code} risk={level.code} />
                  ))}
                </div>
              </div>
              <div
                className="overflow-x-auto pb-1"
                tabIndex={0}
                role="region"
                aria-label="Species and period comparison table; scroll horizontally for all periods"
              >
                <EngineeringTable className="text-xs [&_td]:py-3">
                  <caption className="sr-only">
                    Published forDRAT drought risks for {bgc}, soil regime {smr}
                  </caption>
                  <thead>
                    <tr>
                      <ColumnHeader label="Species" className="sticky left-0 z-10 text-left" />
                      {PUBLISHED_PERIODS.map((item) => (
                        <ColumnHeader
                          key={item.id}
                          label={item.id}
                          unit={item.kind === 'projection' ? 'RCP4.5' : 'Historical'}
                          className={
                            item.id === period
                              ? 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100'
                              : ''
                          }
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row" className="sticky left-0 z-10 border-b bg-background px-2 py-3 text-left">
                        AET / PET
                      </th>
                      {series.map((row) => (
                        <td key={row.period} title={String(row.aetPet)} className="font-semibold">
                          {String(row.aetPet)}
                        </td>
                      ))}
                    </tr>
                    {shownSpecies.map((tree) => (
                      <tr key={tree.code}>
                        <th
                          scope="row"
                          className="sticky left-0 z-10 border-b bg-background px-2 py-3 text-left font-medium"
                        >
                          <span className="block">{tree.code}</span>
                          <span className="block text-2xs font-normal text-muted-foreground">{tree.name}</span>
                        </th>
                        {series.map((row) => (
                          <td key={row.period}>
                            <RiskBadge risk={row.risks[tree.code]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </EngineeringTable>
              </div>
              <p className="px-4 py-3 text-xs text-muted-foreground">
                Download includes all ten species and original numeric precision, regardless of the species filter.
              </p>
            </section>
          )}

          {current && (
            <section className="rounded-xl border bg-background p-4 sm:p-5" aria-labelledby="drought-soils-title">
              <h2 id="drought-soils-title" className="text-base font-semibold">
                Compare soil assumptions
              </h2>
              <p className="mb-4 mt-1 text-xs text-muted-foreground">
                {bgc} · {periodDetails?.label}. These are alternative site contexts, not a probability range.
              </p>
              <StatGroup
                variant="tiles"
                items={allSoils.map((row) => ({
                  label: SOIL_MOISTURE_REGIMES.find((soil) => soil.id === row.smr)?.label ?? row.smrText,
                  value: row.aetPet.toFixed(3),
                  note: `Soil regime ${row.smr} · AET/PET`,
                  onToggle: () => setSmr(row.smr),
                  pressed: row.smr === smr,
                  toggleLabel: `Explore soil regime ${row.smr}: ${row.smrText}`,
                }))}
              />
            </section>
          )}
        </>
      )}

      <section
        className="space-y-3 rounded-xl border bg-muted/20 p-4 text-xs leading-5 text-muted-foreground sm:p-5"
        aria-labelledby="published-source-title"
      >
        <h2 id="published-source-title" className="text-sm font-semibold text-foreground">
          Source and interpretation
        </h2>
        <p>
          Published by the Province of British Columbia in forDRAT, pinned to commit{' '}
          <code>{PUBLISHED_SOURCE.commit.slice(0, 12)}</code>. BEC v11 identifies the BGC units. Future values use the
          ClimateBC 6.21 RCP4.5 ensemble of 15 models. The source CSV’s six period identifiers are preserved, including
          2080.
        </p>
        <p>
          This explorer displays the published data without recalculating species risk. The custom calculation tab uses
          the older forestDroughtTool model and produces a separate set of results.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <ExternalLink href={`${PUBLISHED_SOURCE.repository}/tree/${PUBLISHED_SOURCE.commit}`}>
            Source repository and methods
          </ExternalLink>
          <a
            href={assetPath(PUBLISHED_SOURCE.manifestPath)}
            download="fordrat-source-manifest.json"
            className="underline underline-offset-2"
          >
            Source manifest
          </a>
          <a href={assetPath(PUBLISHED_SOURCE.licensePath)} className="underline underline-offset-2">
            Apache-2.0 license
          </a>
          <a href={assetPath(PUBLISHED_SOURCE.noticePath)} className="underline underline-offset-2">
            Attribution and scope
          </a>
        </div>
      </section>
    </div>
  )
}
