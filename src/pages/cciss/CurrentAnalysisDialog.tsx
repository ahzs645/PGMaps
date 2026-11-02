import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { DialogShell } from '@/components/ui/dialog-shell'
import { FORM_INPUT_CLASS, FormField, NumberField, SelectField } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadText } from '@/lib/download'
import {
  assessCurrentSite,
  CURRENT_BUNDLE_LIMIT,
  currentOptions,
  currentSitesAtPoint,
  parseCurrentBundle,
  type CurrentAssessment,
  type CurrentBundle,
  type CurrentSettings,
} from './currentAnalysis'
import type { ComparisonSnapshot } from './comparison'
import { currentSnapshot } from './comparisonAdapters'
import { ComparisonCapture } from './ComparisonCapture'
import { ShinyReferenceComparison } from './ShinyReferenceComparison'
import {
  currentAnalysisHtml,
  currentAnalysisJson,
  type CurrentAnalysisReport,
  type CurrentAnalysisTable,
} from './currentAnalysisExport'
import { ratingLabel } from './legacyAnalysis'
import {
  DEFAULT_ESTABLISHMENT,
  DEFAULT_MATURATION,
  ESTABLISHMENT_PERIODS,
  MATURATION_PERIODS,
  summarizeVotes,
  type SpeciesReport,
} from './shinyReport'
import { Silvics } from './Silvics'

type Point = [number, number]
type Page = 'species' | 'bgc' | 'overlap' | 'silvics' | 'inputs' | 'reference'
const percent = (value: number | null | undefined) => (value == null ? 'No data' : `${(value * 100).toFixed(1)}%`)
const equalWeights = (names: string[]) => Object.fromEntries(names.map((name) => [name, 1]))
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

interface LoadedBundle {
  bundle: CurrentBundle
  sourceFile: string
  revision: number
}

export function CurrentAnalysisDialog({
  point,
  onPointChange,
  onClose,
  onCaptureComparison,
  onOpenComparison,
  comparisonCount,
}: {
  point?: Point
  onPointChange?: (point: Point) => void
  onClose: () => void
  onCaptureComparison?: (snapshot: ComparisonSnapshot) => void
  onOpenComparison?: () => void
  comparisonCount?: number
}) {
  const [loaded, setLoaded] = useState<LoadedBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )

  async function importFile(file: File) {
    const revision = ++request.current
    setError('')
    setLoading(true)
    try {
      if (file.size > CURRENT_BUNDLE_LIMIT) throw new Error('Choose a pilot JSON file smaller than 25 MB.')
      const bundle = parseCurrentBundle(await file.text())
      if (revision === request.current) setLoaded({ bundle, sourceFile: file.name, revision })
    } catch (error) {
      if (revision === request.current) setError(errorMessage(error))
    } finally {
      if (revision === request.current) setLoading(false)
    }
  }

  return (
    <DialogShell
      title="CCISS current-data analysis"
      subtitle="Import model members → choose a site → assess"
      onClose={onClose}
      size="xl"
    >
      <div className="space-y-4">
        <InlineAlert tone="info">
          Import a CCISS pilot export to calculate weighted BGC predictions locally. Matching ecological tables can
          enable site-series overlap and species suitability. Files stay in this browser session.
        </InlineAlert>
        <FormField
          label="Import current CCISS JSON"
          description="Accepts a raw pilot export or a self-contained analysis bundle. Maximum 25 MB."
        >
          <input
            type="file"
            accept=".json,application/json"
            disabled={loading}
            className="block w-full text-sm"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
              event.target.value = ''
            }}
          />
        </FormField>
        {loading && (
          <p role="status" className="text-sm">
            Validating imported data…
          </p>
        )}
        {error && (
          <div role="alert" className="text-sm text-destructive">
            <p>{error}</p>
            {loaded && <p>The previous dataset remains loaded: {loaded.sourceFile}.</p>}
          </div>
        )}
        {!loaded ? (
          <SidebarSection title="Data needed for a current assessment">
            <p className="text-sm">
              The current province-wide model-member data are not bundled with PGMaps. Request a version-matched pilot
              export from the data owner, including its site geometries, codebook and model dimensions. Add compatible
              E1, E1_Phase and S1 ecological tables for species calculations.
            </p>
            <p className="mt-2 text-sm">
              Importing data does not establish agreement with the deployed Shiny calculator. Dataset versions,
              available calculations and validation limits are shown with every assessment.
            </p>
          </SidebarSection>
        ) : (
          <CurrentWorkspace
            key={loaded.revision}
            loaded={loaded}
            point={point}
            onPointChange={onPointChange}
            onCaptureComparison={onCaptureComparison}
            onOpenComparison={onOpenComparison}
            comparisonCount={comparisonCount}
          />
        )}
      </div>
    </DialogShell>
  )
}

function CurrentWorkspace({
  loaded,
  point,
  onPointChange,
  onCaptureComparison,
  onOpenComparison,
  comparisonCount,
}: {
  loaded: LoadedBundle
  point?: Point
  onPointChange?: (point: Point) => void
  onCaptureComparison?: (snapshot: ComparisonSnapshot) => void
  onOpenComparison?: () => void
  comparisonCount?: number
}) {
  const { bundle, sourceFile } = loaded
  const allOptions = useMemo(() => currentOptions(bundle), [bundle])
  const [siteKey, setSiteKey] = useState(() => {
    const matches = point ? currentSitesAtPoint(bundle, point) : []
    return point ? (matches.length === 1 ? String(matches[0]) : '') : String(allOptions.sites[0].id)
  })
  const site = allOptions.sites.find((candidate) => String(candidate.id) === siteKey)
  const options = useMemo(() => currentOptions(bundle, site?.id), [bundle, site?.id])
  const [seriesChoice, setSeriesChoice] = useState('')
  const series = options.series.includes(seriesChoice) ? seriesChoice : (options.series[0] ?? '')
  const [modelWeights, setModelWeights] = useState(() => equalWeights(allOptions.models))
  const [scenarioWeights, setScenarioWeights] = useState(() => equalWeights(allOptions.scenarios))
  const [noveltyCutoff, setNoveltyCutoff] = useState<number | null>(null)
  const [includeOutOfRange, setIncludeOutOfRange] = useState(true)
  const [establishmentWeights, setEstablishmentWeights] = useState([...DEFAULT_ESTABLISHMENT])
  const [maturationWeights, setMaturationWeights] = useState([...DEFAULT_MATURATION])
  const [speciesChoice, setSpeciesChoice] = useState('')
  const [tab, setTab] = useState<Page>('bgc')
  const calculation = useMemo(() => {
    if (!site) return { assessment: null, error: '' }
    try {
      return {
        assessment: assessCurrentSite(bundle, {
          siteId: site.id,
          series: series || undefined,
          modelWeights,
          scenarioWeights,
          noveltyCutoff,
          includeOutOfRange,
          establishmentWeights,
          maturationWeights,
        }),
        error: '',
      }
    } catch (error) {
      return { assessment: null, error: errorMessage(error) }
    }
  }, [
    bundle,
    site,
    series,
    modelWeights,
    scenarioWeights,
    noveltyCutoff,
    includeOutOfRange,
    establishmentWeights,
    maturationWeights,
  ])
  const assessment = calculation.assessment
  const activeTab = tab === 'silvics' && !assessment?.species.length ? 'bgc' : tab
  const selectedSpecies = assessment?.species.find((row) => row.species === speciesChoice) ?? assessment?.species[0]
  const capabilities = assessment ? capabilityRows(assessment) : []
  const settings: CurrentSettings | null = site
    ? {
        siteId: site.id,
        series: series || undefined,
        modelWeights,
        scenarioWeights,
        noveltyCutoff,
        includeOutOfRange,
        establishmentWeights,
        maturationWeights,
      }
    : null

  function snapshot(): CurrentAnalysisReport | null {
    if (!assessment || !site) return null
    const summaries = assessment.species.map(
      (row) => assessment.summaries.find((entry) => entry.species === row.species)?.summary ?? null,
    )
    return {
      schema: 'cciss-current-analysis-report-v1',
      generatedAt: new Date().toISOString(),
      sourceFile,
      provenance: Object.fromEntries(
        Object.entries({ ...bundle.provenance, independentShinyParityVerified: false }).filter(
          ([, value]) => value !== undefined,
        ),
      ),
      selection: {
        siteId: site.id,
        baselineBgc: site.bgc,
        series: series || null,
        modelWeights,
        scenarioWeights,
        noveltyCutoff,
        includeOutOfRange,
        establishmentWeights,
        maturationWeights,
      },
      capabilities: capabilities.filter((row) => row.available).map((row) => row.label),
      limitations: [
        ...assessment.warnings,
        'Independent agreement with deployed Shiny results has not been established.',
      ],
      tables: assessmentTables(assessment, summaries),
      calculation: assessment,
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">Loaded dataset: {sourceFile}</p>
      {bundle.provenance.synthetic && (
        <InlineAlert tone="warning">
          Synthetic verification data. These results have no geographic or planning meaning.
        </InlineAlert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Assessment site" value={siteKey} onChange={(event) => setSiteKey(event.target.value)}>
          {!site && <option value="">Choose an imported site</option>}
          {allOptions.sites.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.id} · {candidate.bgc}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Current site series"
          value={series}
          disabled={!options.series.length || !site}
          onChange={(event) => setSeriesChoice(event.target.value)}
        >
          {!options.series.length && <option value="">Compatible ecological tables required</option>}
          {options.series.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </SelectField>
      </div>
      <PointLookup
        bundle={bundle}
        point={point}
        onSelect={(id, matchedPoint) => {
          setSiteKey(id === null ? '' : String(id))
          if (id !== null) onPointChange?.(matchedPoint)
        }}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <WeightPreset
          label="Climate models"
          names={allOptions.models}
          weights={modelWeights}
          onChange={setModelWeights}
        />
        <WeightPreset
          label="Emissions scenarios"
          names={allOptions.scenarios}
          weights={scenarioWeights}
          onChange={setScenarioWeights}
        />
      </div>
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">Model weights and calculation options</summary>
        <div className="mt-4 space-y-4">
          <p className="text-xs text-muted-foreground">
            Weights are relative within each group. Zero excludes an option. Available runs contribute equally within
            their model and scenario.
          </p>
          {allOptions.runs.length > 0 && (
            <p className="text-xs text-muted-foreground">Available runs: {allOptions.runs.join(', ')}.</p>
          )}
          <WeightFields
            label="Model weights"
            names={allOptions.models}
            weights={modelWeights}
            onChange={setModelWeights}
          />
          <WeightFields
            label="Scenario weights"
            names={allOptions.scenarios}
            weights={scenarioWeights}
            onChange={setScenarioWeights}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={noveltyCutoff !== null}
              onChange={(event) => setNoveltyCutoff(event.target.checked ? 5 : null)}
            />
            Apply novelty cutoff
          </label>
          {noveltyCutoff !== null && (
            <NumberField
              label="Novelty cutoff"
              value={noveltyCutoff}
              onValueChange={setNoveltyCutoff}
              min={1}
              max={8}
              step={0.1}
              unit="sigma"
            />
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeOutOfRange}
              onChange={(event) => setIncludeOutOfRange(event.target.checked)}
            />
            Include out-of-range ecological ratings
          </label>
          <p className="text-xs text-muted-foreground">
            Period summary weights follow the current calculator periods. Missing or incomplete conditional vote periods
            withhold the summary.
          </p>
          <PeriodWeights
            label="Establishment"
            periods={ESTABLISHMENT_PERIODS}
            weights={establishmentWeights}
            onChange={setEstablishmentWeights}
          />
          <PeriodWeights
            label="Maturation"
            periods={MATURATION_PERIODS}
            weights={maturationWeights}
            onChange={setMaturationWeights}
          />
        </div>
      </details>
      {calculation.error && (
        <p role="alert" className="text-sm text-destructive">
          {calculation.error}
        </p>
      )}
      {!site && <InlineAlert tone="warning">Choose a covered imported site to calculate an assessment.</InlineAlert>}
      {assessment && (
        <>
          <ComparisonCapture
            onCapture={onCaptureComparison}
            onOpen={onOpenComparison}
            count={comparisonCount}
            actions={[
              {
                label: 'Save for comparison',
                create: (label) =>
                  currentSnapshot(assessment, {
                    label,
                    settings: settings!,
                    sourceFile,
                  }),
              },
            ]}
          />
          <p className="text-sm">
            Assessment for imported site <strong>{assessment.siteId}</strong> · Baseline BGC:{' '}
            <strong>{assessment.bgc}</strong>
            {assessment.series ? ` · ${assessment.series}` : ''}.
          </p>
          {assessment.warnings.length > 0 && (
            <InlineAlert tone="warning">
              <ul className="list-disc space-y-1 pl-4">
                {assessment.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </InlineAlert>
          )}
          <TabBar
            label="Current assessment pages"
            value={activeTab}
            onChange={setTab}
            options={[
              { value: 'bgc', label: 'BGC futures' },
              { value: 'species', label: 'Species' },
              { value: 'overlap', label: 'Site-series overlap' },
              { value: 'silvics', label: 'Silvics', disabled: !assessment.species.length },
              { value: 'inputs', label: 'Inputs and export' },
              { value: 'reference', label: 'Compare with Shiny' },
            ]}
          />
          {activeTab === 'reference' && settings && (
            <ShinyReferenceComparison assessment={assessment} settings={settings} sourceFile={sourceFile} />
          )}
          {activeTab === 'bgc' && (
            <SidebarSection title="Weighted BGC probabilities">
              <p className="mb-3 text-xs text-muted-foreground">
                Probabilities use the imported members and selected model/scenario weights. Original period identifiers
                are retained.
              </p>
              <DataTable
                table={{
                  title: 'Current BGC probabilities',
                  columns: ['Period', 'Predicted BGC', 'Probability', 'Contributing members'],
                  rows: assessment.bgcProbabilities.map((row) => [
                    row.period,
                    row.bgc,
                    percent(row.probability),
                    row.members,
                  ]),
                }}
              />
            </SidebarSection>
          )}
          {activeTab === 'species' && (
            <SpeciesView assessment={assessment} selected={selectedSpecies} onSelect={setSpeciesChoice} />
          )}
          {activeTab === 'overlap' && (
            <SidebarSection title="Predicted site-series overlap">
              {assessment.capabilities.siteSeries ? (
                <DataTable
                  table={{
                    title: 'Current site-series overlap',
                    columns: ['Period', 'Predicted BGC', 'Predicted site series', 'Probability'],
                    rows: assessment.overlap.map((row) => [
                      row.period,
                      row.predictedBgc,
                      row.predictedSeries,
                      percent(row.probability),
                    ]),
                  }}
                />
              ) : (
                <p className="text-sm">
                  Compatible, version-matched ecological tables are required for site-series overlap. BGC predictions
                  remain available independently.
                </p>
              )}
            </SidebarSection>
          )}
          {activeTab === 'silvics' && selectedSpecies && (
            <>
              <SelectField
                label="Silvics species"
                value={selectedSpecies.species}
                onChange={(event) => setSpeciesChoice(event.target.value)}
              >
                {assessment.species.map((row) => (
                  <option key={row.species}>{row.species}</option>
                ))}
              </SelectField>
              <Silvics species={selectedSpecies.species} />
            </>
          )}
          {activeTab === 'inputs' && (
            <SidebarSection title="Dataset, capability and export">
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
                {Object.entries(bundle.provenance).map(([key, value]) => (
                  <div className="contents" key={key}>
                    <dt className="font-medium">
                      {key === 'versionMatched' ? 'Version match asserted by supplier' : key}
                    </dt>
                    <dd className="break-words">{String(value)}</dd>
                  </div>
                ))}
              </dl>
              <p className="my-3 text-xs text-muted-foreground">
                Independent agreement with deployed Shiny results has not been established. A supplier assertion or
                successful structural validation does not establish that agreement.
              </p>
              <ul className="mb-4 space-y-1 text-sm">
                {capabilities.map((row) => (
                  <li key={row.label}>
                    {row.label}: {row.available ? 'Available' : 'Required inputs unavailable'}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => {
                    const report = snapshot()
                    if (report)
                      downloadText(currentAnalysisJson(report), 'cciss-current-analysis.json', 'application/json')
                  }}
                >
                  Download assessment JSON
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const report = snapshot()
                    if (report) downloadText(currentAnalysisHtml(report), 'cciss-current-analysis.html', 'text/html')
                  }}
                >
                  Download printable assessment
                </Button>
              </div>
            </SidebarSection>
          )}
        </>
      )}
    </div>
  )
}

function PointLookup({
  bundle,
  point,
  onSelect,
}: {
  bundle: CurrentBundle
  point?: Point
  onSelect: (siteId: number | null, point: Point) => void
}) {
  const [longitude, setLongitude] = useState(point ? String(point[0]) : '')
  const [latitude, setLatitude] = useState(point ? String(point[1]) : '')
  const [message, setMessage] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    const coordinates: Point = [Number(longitude), Number(latitude)]
    if (
      !longitude.trim() ||
      !latitude.trim() ||
      !coordinates.every(Number.isFinite) ||
      Math.abs(coordinates[0]) > 180 ||
      Math.abs(coordinates[1]) > 90
    ) {
      onSelect(null, coordinates)
      setMessage('Enter a longitude from −180 to 180 and latitude from −90 to 90.')
      return
    }
    const matches = currentSitesAtPoint(bundle, coordinates)
    onSelect(matches.length === 1 ? matches[0] : null, coordinates)
    setMessage(
      matches.length === 1
        ? `Location is covered by imported site ${matches[0]}.`
        : matches.length > 1
          ? `This boundary location matches sites ${matches.join(', ')}. Choose the intended site explicitly.`
          : 'No imported site covers this location. Choose another location or explicitly select an imported site.',
    )
  }
  return (
    <form onSubmit={submit} className="rounded-md border border-border p-3">
      <p className="mb-3 text-xs text-muted-foreground">
        Locate a point within the imported site polygons. Coverage is limited to this pilot; a nearest site is never
        substituted.
      </p>
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <FormField label="Pilot longitude">
          <input
            className={FORM_INPUT_CLASS}
            inputMode="decimal"
            value={longitude}
            onChange={(event) => setLongitude(event.target.value)}
          />
        </FormField>
        <FormField label="Pilot latitude">
          <input
            className={FORM_INPUT_CLASS}
            inputMode="decimal"
            value={latitude}
            onChange={(event) => setLatitude(event.target.value)}
          />
        </FormField>
        <Button type="submit" variant="outline">
          Find imported site
        </Button>
      </div>
      {message && (
        <p role="status" className="mt-2 text-sm">
          {message}
        </p>
      )}
    </form>
  )
}

function weightPreset(names: string[], weights: Record<string, number>) {
  const active = names.filter((name) => weights[name] > 0)
  if (active.length === 1) return active[0]
  if (active.length === names.length && names.every((name) => weights[name] === weights[names[0]])) return '__all__'
  return '__custom__'
}

function WeightPreset({
  label,
  names,
  weights,
  onChange,
}: {
  label: string
  names: string[]
  weights: Record<string, number>
  onChange: (weights: Record<string, number>) => void
}) {
  return (
    <SelectField
      label={label}
      value={weightPreset(names, weights)}
      onChange={(event) =>
        onChange(
          Object.fromEntries(
            names.map((name) => [name, event.target.value === '__all__' || event.target.value === name ? 1 : 0]),
          ),
        )
      }
    >
      <option value="__all__">All available · equal weights</option>
      <option value="__custom__" disabled>
        Custom weights
      </option>
      {names.map((name) => (
        <option key={name}>{name}</option>
      ))}
    </SelectField>
  )
}

function WeightFields({
  label,
  names,
  weights,
  onChange,
}: {
  label: string
  names: string[]
  weights: Record<string, number>
  onChange: (weights: Record<string, number>) => void
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {names.map((name) => (
          <NumberField
            key={name}
            label={name}
            value={weights[name] ?? 0}
            onValueChange={(value) => onChange({ ...weights, [name]: value })}
            min={0}
            step={0.1}
          />
        ))}
      </div>
    </fieldset>
  )
}

function PeriodWeights({
  label,
  periods,
  weights,
  onChange,
}: {
  label: string
  periods: string[]
  weights: number[]
  onChange: (weights: number[]) => void
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label} period weights</legend>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {periods.map((period, index) => (
          <NumberField
            key={period}
            label={`${label} ${period}`}
            value={weights[index]}
            min={0}
            step={0.05}
            onValueChange={(value) =>
              onChange(weights.map((weight, position) => (position === index ? value : weight)))
            }
          />
        ))}
      </div>
    </fieldset>
  )
}

function SpeciesView({
  assessment,
  selected,
  onSelect,
}: {
  assessment: CurrentAssessment
  selected: SpeciesReport | undefined
  onSelect: (species: string) => void
}) {
  if (!assessment.capabilities.suitability)
    return (
      <SidebarSection title="Species suitability">
        <p className="text-sm">
          Species calculations require compatible, version-matched ecological tables. Inspect the input warnings for the
          missing or unsupported data.
        </p>
      </SidebarSection>
    )
  const summaries = assessment.species.map(
    (row) => assessment.summaries.find((entry) => entry.species === row.species)?.summary ?? null,
  )
  return (
    <div className="space-y-4">
      <SidebarSection title="Species suitability">
        <DataTable table={speciesSummaryTable(assessment, summaries)} />
      </SidebarSection>
      {selected && (
        <SidebarSection title="Period-by-period suitability">
          <SelectField
            label="Assessment species detail"
            value={selected.species}
            onChange={(event) => onSelect(event.target.value)}
          >
            {assessment.species.map((row) => (
              <option key={row.species}>{row.species}</option>
            ))}
          </SelectField>
          <div className="mt-3">
            <DataTable
              table={{
                title: 'Current species vote proportions',
                columns: ['Period', 'High', 'Moderate', 'Low', 'Unsuitable', 'Novel climate'],
                rows: Object.keys(selected.votes)
                  .sort()
                  .map((period) => [
                    period,
                    ...[0, 1, 2, 3].map((index) => percent(selected.votes[period]?.[index])),
                    percent(selected.novelty[period]),
                  ]),
              }}
            />
          </div>
        </SidebarSection>
      )}
      <p className="text-xs text-muted-foreground">
        No rating means unavailable data. Summaries use complete conditional votes before novelty is applied to display
        proportions; original period identifiers are retained.
      </p>
    </div>
  )
}

function capabilityRows(assessment: CurrentAssessment) {
  return [
    { label: 'Weighted BGC predictions', available: assessment.capabilities.predictions },
    { label: 'Site-series overlap', available: assessment.capabilities.siteSeries },
    { label: 'Species suitability votes', available: assessment.capabilities.suitability },
    { label: 'Current-period suitability summaries', available: assessment.capabilities.summaries },
  ]
}

function speciesSummaryTable(
  assessment: CurrentAssessment,
  summaries: ReturnType<typeof summarizeVotes>[],
): CurrentAnalysisTable {
  return {
    title: 'Current species suitability summary',
    columns: [
      'Species',
      'Baseline',
      'Establishment',
      'Maturation',
      'Stable / improving (%)',
      'Declining / unsuitable (%)',
    ],
    rows: assessment.species.map((row, index) => [
      row.species,
      ratingLabel(row.current),
      summaries[index] ? ratingLabel(summaries[index]!.establishment) : 'Not calculated',
      summaries[index] ? ratingLabel(summaries[index]!.maturation) : 'Not calculated',
      summaries[index]?.improve ?? null,
      summaries[index]?.decline ?? null,
    ]),
  }
}

function assessmentTables(
  assessment: CurrentAssessment,
  summaries: ReturnType<typeof summarizeVotes>[],
): CurrentAnalysisTable[] {
  return [
    {
      title: 'BGC probabilities',
      columns: ['Period', 'BGC', 'Probability (0–1)', 'Contributing members'],
      rows: assessment.bgcProbabilities.map((row) => [row.period, row.bgc, row.probability, row.members]),
    },
    {
      title: 'Site-series overlap',
      columns: ['Period', 'Predicted BGC', 'Predicted site series', 'Probability (0–1)'],
      rows: assessment.overlap.map((row) => [row.period, row.predictedBgc, row.predictedSeries, row.probability]),
    },
    speciesSummaryTable(assessment, summaries),
    {
      title: 'Species vote proportions',
      columns: [
        'Species',
        'Period',
        'High (0–1)',
        'Moderate (0–1)',
        'Low (0–1)',
        'Unsuitable (0–1)',
        'Novel climate (0–1)',
      ],
      rows: assessment.species.flatMap((row) =>
        Object.keys(row.votes)
          .sort()
          .map((period) => [
            row.species,
            period,
            ...[0, 1, 2, 3].map((index) => row.votes[period]?.[index] ?? null),
            row.novelty[period] ?? null,
          ]),
      ),
    },
  ]
}

function DataTable({ table }: { table: CurrentAnalysisTable }) {
  if (!table.rows.length) return <p className="text-sm">No rows are available for this selection.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{table.title}</caption>
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column} scope="col" className="px-2 py-2">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index} className="border-t border-border">
              {row.map((value, position) => (
                <td key={position} className="px-2 py-2">
                  {value === null ? 'No data' : value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
