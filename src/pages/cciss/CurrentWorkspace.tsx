import { useMemo, useState } from 'react'
import { SelectField } from '@/components/ui/form-field'
import { InlineAlert, KeyValueRows, SidebarSection } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { downloadText } from '@/lib/download'
import { AlertList } from './AlertList'
import { AnalysisTable } from './AnalysisTable'
import type { ComparisonSnapshot } from './comparison'
import { currentSnapshot } from './comparisonAdapters'
import { ComparisonCapture } from './ComparisonCapture'
import { CoordinateForm, type LngLat } from './CoordinateForm'
import {
  assessCurrentSite,
  currentOptions,
  currentSitesAtPoint,
  type CurrentBundle,
  type CurrentSettings,
} from './currentAnalysis'
import { currentAnalysisHtml, currentAnalysisJson } from './currentAnalysisExport'
import { capabilityRows, currentAnalysisReport, percentOrNoData } from './currentAnalysisTables'
import { CurrentCalculationOptions, WeightPreset, type CalculationOptions } from './CurrentCalculationOptions'
import { CurrentSpeciesView } from './CurrentSpeciesView'
import { DownloadActions } from './DownloadActions'
import {
  DEFAULT_ESTABLISHMENT,
  DEFAULT_MATURATION,
  SHINY_GCM_WEIGHTS,
  SHINY_NOVELTY_CUTOFF,
  SHINY_SCENARIO_WEIGHTS,
  shinyDefaultWeights,
} from './shinyReport'
import { ShinyReferenceComparison } from './ShinyReferenceComparison'
import { Silvics } from './Silvics'
import { errorMessage } from './useLatestRequest'

type Page = 'species' | 'bgc' | 'overlap' | 'silvics' | 'inputs' | 'reference'

export interface LoadedBundle {
  bundle: CurrentBundle
  sourceFile: string
  revision: number
}

/** Locates a typed point among the imported site polygons; it never substitutes the nearest site. */
function SiteLookup({
  bundle,
  point,
  onSelect,
}: {
  bundle: CurrentBundle
  point?: LngLat
  onSelect: (siteId: number | null, point: LngLat) => void
}) {
  const [message, setMessage] = useState('')
  return (
    <div className="rounded-md border border-border p-3">
      <p className="mb-3 text-xs text-muted-foreground">
        Locate a point within the imported site polygons. Coverage is limited to this pilot; a nearest site is never
        substituted.
      </p>
      <CoordinateForm
        initial={point}
        longitudeLabel="Pilot longitude"
        latitudeLabel="Pilot latitude"
        submitLabel="Find imported site"
        submitVariant="outline"
        onSubmit={(coordinates, raw) => {
          if (!coordinates) {
            onSelect(null, raw)
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
        }}
      >
        {message && (
          <p role="status" className="mt-2 text-sm">
            {message}
          </p>
        )}
      </CoordinateForm>
    </div>
  )
}

/** One imported bundle: choose a site and weights, then read its BGC, overlap and species results. */
export function CurrentWorkspace({
  loaded,
  point,
  onPointChange,
  onCaptureComparison,
  onOpenComparison,
  comparisonCount,
}: {
  loaded: LoadedBundle
  point?: LngLat
  onPointChange?: (point: LngLat) => void
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
  // Start from the Shiny app's defaults so a default run is comparable with a default Shiny export.
  const modelDefaults = useMemo(() => shinyDefaultWeights(allOptions.models, SHINY_GCM_WEIGHTS), [allOptions.models])
  const scenarioDefaults = useMemo(
    () => shinyDefaultWeights(allOptions.scenarios, SHINY_SCENARIO_WEIGHTS),
    [allOptions.scenarios],
  )
  // Shiny applies novelty by default; do so only when the bundle has every novelty value, so a default run cannot fail.
  const completeNovelty = bundle.pilot.novelty.every((entry) => entry.novelty.every((value) => value !== null))
  const [calculationOptions, setCalculationOptions] = useState<CalculationOptions>(() => ({
    modelWeights: modelDefaults.weights,
    scenarioWeights: scenarioDefaults.weights,
    noveltyCutoff: completeNovelty ? SHINY_NOVELTY_CUTOFF : null,
    includeOutOfRange: true,
    establishmentWeights: [...DEFAULT_ESTABLISHMENT],
    maturationWeights: [...DEFAULT_MATURATION],
  }))
  const changeOptions = (patch: Partial<CalculationOptions>) =>
    setCalculationOptions((current) => ({ ...current, ...patch }))
  const [speciesChoice, setSpeciesChoice] = useState('')
  const [tab, setTab] = useState<Page>('bgc')

  const settings: CurrentSettings | null = useMemo(
    () => (site ? { siteId: site.id, series: series || undefined, ...calculationOptions } : null),
    [site, series, calculationOptions],
  )
  const calculation = useMemo(() => {
    if (!settings) return { assessment: null, error: '' }
    try {
      return { assessment: assessCurrentSite(bundle, settings), error: '' }
    } catch (error) {
      return { assessment: null, error: errorMessage(error) }
    }
  }, [bundle, settings])
  const assessment = calculation.assessment
  const activeTab = tab === 'silvics' && !assessment?.species.length ? 'bgc' : tab
  const selectedSpecies = assessment?.species.find((row) => row.species === speciesChoice) ?? assessment?.species[0]
  const unmatched = [...modelDefaults.unmatched, ...scenarioDefaults.unmatched]
  const defaultsNote = [
    `Weights are relative within each group. Zero excludes an option. Available runs contribute equally within their model and scenario. Defaults follow the CCISS Shiny app${completeNovelty ? ', including its novelty cutoff of 5' : ''}.`,
    unmatched.length > 0 && `Not in Shiny's defaults, so weighted 1: ${unmatched.join(', ')}.`,
    (modelDefaults.fallback || scenarioDefaults.fallback) &&
      'Shiny weights every available option in a group at zero, so all of them start at 1.',
    !completeNovelty && 'Novelty filtering starts off because this bundle has missing novelty values.',
  ]
    .filter(Boolean)
    .join(' ')

  function download(format: 'json' | 'html') {
    if (!assessment || !site || !settings) return
    const report = currentAnalysisReport(assessment, bundle, settings, sourceFile, site.bgc)
    if (format === 'json') downloadText(currentAnalysisJson(report), 'cciss-current-analysis.json', 'application/json')
    else downloadText(currentAnalysisHtml(report), 'cciss-current-analysis.html', 'text/html')
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
      <SiteLookup
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
          weights={calculationOptions.modelWeights}
          onChange={(modelWeights) => changeOptions({ modelWeights })}
        />
        <WeightPreset
          label="Emissions scenarios"
          names={allOptions.scenarios}
          weights={calculationOptions.scenarioWeights}
          onChange={(scenarioWeights) => changeOptions({ scenarioWeights })}
        />
      </div>
      <CurrentCalculationOptions
        models={allOptions.models}
        scenarios={allOptions.scenarios}
        runs={allOptions.runs}
        value={calculationOptions}
        onChange={changeOptions}
        defaultsNote={defaultsNote}
      />
      {calculation.error && <InlineAlert tone="error">{calculation.error}</InlineAlert>}
      {!site && <InlineAlert tone="warning">Choose a covered imported site to calculate an assessment.</InlineAlert>}
      {assessment && settings && (
        <>
          <ComparisonCapture
            onCapture={onCaptureComparison}
            onOpen={onOpenComparison}
            count={comparisonCount}
            actions={[
              {
                label: 'Save for comparison',
                create: (label) => currentSnapshot(assessment, { label, settings, sourceFile }),
              },
            ]}
          />
          <p className="text-sm">
            Assessment for imported site <strong>{assessment.siteId}</strong> · Baseline BGC:{' '}
            <strong>{assessment.bgc}</strong>
            {assessment.series ? ` · ${assessment.series}` : ''}.
          </p>
          <AlertList items={assessment.warnings} />
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
          {activeTab === 'reference' && (
            <ShinyReferenceComparison assessment={assessment} settings={settings} sourceFile={sourceFile} />
          )}
          {activeTab === 'bgc' && (
            <SidebarSection title="Weighted BGC probabilities">
              <p className="mb-3 text-xs text-muted-foreground">
                Probabilities use the imported members and selected model/scenario weights. Original period identifiers
                are retained.
              </p>
              <AnalysisTable
                textColumns={2}
                table={{
                  title: 'Current BGC probabilities',
                  columns: ['Period', 'Predicted BGC', 'Probability', 'Contributing members'],
                  rows: assessment.bgcProbabilities.map((row) => [
                    row.period,
                    row.bgc,
                    percentOrNoData(row.probability),
                    row.members,
                  ]),
                }}
              />
            </SidebarSection>
          )}
          {activeTab === 'species' && (
            <CurrentSpeciesView assessment={assessment} selected={selectedSpecies} onSelect={setSpeciesChoice} />
          )}
          {activeTab === 'overlap' && (
            <SidebarSection title="Predicted site-series overlap">
              {assessment.capabilities.siteSeries ? (
                <AnalysisTable
                  textColumns={3}
                  table={{
                    title: 'Current site-series overlap',
                    columns: ['Period', 'Predicted BGC', 'Predicted site series', 'Probability'],
                    rows: assessment.overlap.map((row) => [
                      row.period,
                      row.predictedBgc,
                      row.predictedSeries,
                      percentOrNoData(row.probability),
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
              <KeyValueRows
                variant="grid"
                size="sm"
                rows={Object.entries(bundle.provenance).map(([key, value]) => ({
                  key,
                  label: key === 'versionMatched' ? 'Version match asserted by supplier' : key,
                  value: String(value),
                }))}
              />
              <p className="my-3 text-xs text-muted-foreground">
                Independent agreement with deployed Shiny results has not been established. A supplier assertion or
                successful structural validation does not establish that agreement.
              </p>
              <KeyValueRows
                className="mb-4"
                size="sm"
                valueMaxWidth={null}
                rows={capabilityRows(assessment).map((row) => ({
                  key: row.label,
                  label: row.label,
                  value: row.available ? 'Available' : 'Required inputs unavailable',
                }))}
              />
              <DownloadActions
                actions={[
                  { label: 'Download assessment JSON', onClick: () => download('json') },
                  { label: 'Download printable assessment', onClick: () => download('html') },
                ]}
              />
            </SidebarSection>
          )}
        </>
      )}
    </div>
  )
}
