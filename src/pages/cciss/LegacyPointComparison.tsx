import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SelectField } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { TabBar } from '@/components/ui/tab-bar'
import { TextButton } from '@/components/ui/text-button'
import { downloadText } from '@/lib/download'
import type { ComparisonSnapshot } from './comparison'
import { ComparisonCapture } from './ComparisonCapture'
import { DownloadActions } from './DownloadActions'
import {
  legacyConditionLabel,
  legacyScenarioLabel,
  legacySiteConditions,
  legacySpecies,
  preferredLegacyOption,
  ratingLabel,
  regionalOutlook,
  type Edatope,
} from './legacyAnalysis'
import {
  compareLegacyPoint,
  LEGACY_LIMITATION,
  legacyComparisonHtml,
  memberKey,
  type LegacyComparisonReport,
} from './legacyComparison'
import { legacyComparisonSnapshot } from './legacyComparisonAdapter'
import { LegacySpeciesTable, ModelPeriodMatrix, periodLabel, Rating, RegionalTrendTable } from './LegacyTables'
import { Silvics } from './Silvics'
import { useLegacyData } from './useLegacyData'

type Page = 'species' | 'models' | 'bgc' | 'region' | 'silvics' | 'report'

/** The legacy point comparison: controls, the six pages, saving for comparison and both exports. */
export function LegacyPointComparison({
  point,
  onCaptureComparison,
  onOpenComparison,
  comparisonCount,
}: {
  point: [number, number]
  onCaptureComparison?: (snapshot: ComparisonSnapshot) => void
  onOpenComparison?: () => void
  comparisonCount: number
}) {
  const [tab, setTab] = useState<Page>('species')
  const [edatope, setEdatope] = useState<Edatope>('C4')
  const [scenario, setScenario] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [period, setPeriod] = useState('2061_2080')
  const [species, setSpecies] = useState('Pl')
  const [region, setRegion] = useState('BC')
  const legacy = useLegacyData(point, region)
  const { data, pointKey, regionId, regionError } = legacy
  const siteConditions = useMemo(() => (data ? legacySiteConditions(data.reference, data.summary) : []), [data])
  const condition = preferredLegacyOption(siteConditions, edatope)
  const comparison = useMemo(
    () =>
      data?.pointKey === pointKey && condition
        ? compareLegacyPoint(
            data.reference,
            data.samples,
            condition,
            legacySpecies(data.reference, data.summary, condition),
          )
        : null,
    [data, pointKey, condition],
  )
  if (legacy.error !== null)
    return (
      <div>
        <InlineAlert tone="error">Could not load analysis: {legacy.error}</InlineAlert>
        <Button onClick={legacy.retry}>Retry analysis</Button>
      </div>
    )
  if (!data || !comparison) return <InlineAlert loading>{legacy.progress ?? 'Loading dataset…'}</InlineAlert>
  if (!comparison.members.length || !comparison.species.length || !siteConditions.length)
    return (
      <InlineAlert tone="warning">
        This dataset has no compatible model projections, site conditions or species to compare.
      </InlineAlert>
    )

  const scenarios = [...new Set(comparison.members.map((m) => m.scenario))]
  const selectedScenario = preferredLegacyOption(scenarios, scenario)
  const scenarioMembers = comparison.members.filter((m) => m.scenario === selectedScenario)
  // A model/run remains selected across scenario changes when the dataset contains that exact member.
  const requestedMember = comparison.members.find((m) => m.key === modelKey)
  const member =
    scenarioMembers.find((m) => m.key === modelKey) ??
    scenarioMembers.find((m) => m.model === requestedMember?.model && m.run === requestedMember?.run) ??
    scenarioMembers[0]
  const memberLabel = (m: typeof member) => `${m.model} · ${m.run} · ${legacyScenarioLabel(m.scenario)}`
  const memberPeriods = comparison.projections
    .filter((r) => memberKey(r) === member.key)
    .map((r) => r.period)
    .sort()
  const selectedPeriod = preferredLegacyOption(memberPeriods, period)
  const selectedSpecies = comparison.species.find((s) => s.species === species) ?? comparison.species[0]
  const future = comparison.projections.find((r) => memberKey(r) === member.key && r.period === selectedPeriod)
  const trends = legacy.regionValue
    ? regionalOutlook(legacy.regionValue, condition, selectedSpecies.species, member.model, {
        run: member.run,
        scenario: member.scenario,
        baselinePeriod: comparison.baseline?.period,
      })
    : []
  const report: LegacyComparisonReport = {
    schema: 'cciss-legacy-comparison-v1',
    method: LEGACY_LIMITATION,
    source: 'Province of British Columbia · CCISS_ShinyApp/Development/OLD/spatial_app',
    dataset: data.manifest.schema,
    provenance: data.manifest,
    longitude: point[0],
    latitude: point[1],
    edatope: condition,
    comparison,
    regional: {
      region: regionId || 'No regional summary',
      species: selectedSpecies.species,
      model: member.model,
      scenario: member.scenario,
      run: member.run,
      trends,
    },
  }
  const readyToExport = !legacy.selectedRegion || (Boolean(legacy.regionValue) && !regionError)
  const modelProjections = selectedSpecies.projections.filter((r) => r.member === member.key)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SelectField
          label="Site condition"
          aria-label="Analysis site condition"
          value={condition}
          onChange={(e) => setEdatope(e.target.value as Edatope)}
        >
          {siteConditions.map((value) => (
            <option key={value} value={value}>
              {legacyConditionLabel(value)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Emissions scenario" value={selectedScenario} onChange={(e) => setScenario(e.target.value)}>
          {scenarios.map((value) => (
            <option key={value} value={value}>
              {legacyScenarioLabel(value)}
            </option>
          ))}
        </SelectField>
        <SelectField label="Climate model" value={member.key} onChange={(e) => setModelKey(e.target.value)}>
          {scenarioMembers.map((m) => (
            <option key={m.key} value={m.key}>
              {m.model} · {m.run}
            </option>
          ))}
        </SelectField>
        <SelectField label="Projection period" value={selectedPeriod} onChange={(e) => setPeriod(e.target.value)}>
          {memberPeriods.map((p) => (
            <option key={p} value={p}>
              {periodLabel(p)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Comparison species"
          value={selectedSpecies.species}
          onChange={(e) => setSpecies(e.target.value)}
        >
          {comparison.species.map((s) => (
            <option key={s.species} value={s.species}>
              {s.species} · {s.name}
            </option>
          ))}
        </SelectField>
      </div>
      <p className="text-sm">
        {point[1].toFixed(5)}, {point[0].toFixed(5)} · Reference BGC:{' '}
        <strong>{comparison.baseline?.bgc ?? 'No data'}</strong> → Predicted BGC:{' '}
        <strong>{future?.bgc ?? 'No data'}</strong> ({periodLabel(selectedPeriod)})
      </p>
      <ComparisonCapture
        onCapture={onCaptureComparison}
        onOpen={onOpenComparison}
        count={comparisonCount}
        nameLabel="Comparison label"
        namePlaceholder={`${point[1].toFixed(5)}, ${point[0].toFixed(5)} · ${member.model} · ${legacyScenarioLabel(member.scenario)} · ${member.run ?? 'No run ID'} · ${condition}`}
        description="Saves this location, site condition and actual model run across all available species and periods. Saved results stay fixed when you change the controls. Regional ratios retain their separate named-area scope."
        openLabel="Open comparisons"
        actions={[
          {
            label: 'Save for comparison',
            disabled: !readyToExport,
            create: (label) =>
              legacyComparisonSnapshot(report, { member: member.key, reference: data.reference, label }),
          },
        ]}
      />
      {(!comparison.baseline?.bgc || !future?.bgc) && (
        <InlineAlert tone="warning">
          This location has no valid BGC in one or both selected legacy rasters. Choose a land location inside BC.
          Missing results remain unknown; named-region summaries are still available.
        </InlineAlert>
      )}
      <TabBar
        label="Legacy analysis pages"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'species', label: 'Species' },
          { value: 'models', label: 'Model comparison' },
          { value: 'bgc', label: 'BGC changes' },
          { value: 'region', label: 'Regional outlook' },
          { value: 'silvics', label: 'Silvics' },
          { value: 'report', label: 'Report' },
        ]}
      />
      {tab === 'species' && (
        <SidebarSection title="Species suitability at the selected map point">
          <p className="mb-3 text-xs text-muted-foreground">
            {member.model} · {member.run} · {legacyScenarioLabel(member.scenario)}. Available model periods are shown;
            the outlined column is the selected period. Observed values come from a separate historical raster. No
            rating means no lookup result, not unsuitable.
          </p>
          <LegacySpeciesTable comparison={comparison} member={member.key} selectedPeriod={selectedPeriod} />
        </SidebarSection>
      )}
      {tab === 'models' && (
        <SidebarSection title={`Model comparison · ${selectedSpecies.species}`}>
          <p className="mb-3 text-sm">
            {selectedSpecies.name} · baseline: {ratingLabel(selectedSpecies.baseline)}. Each row is one available model
            run. The available runs and scenarios are listed separately; their counts are not ensemble probabilities.
          </p>
          <ModelPeriodMatrix
            caption="Species by model and period"
            periods={comparison.periods}
            rows={comparison.members.map((m) => ({
              label: memberLabel(m),
              values: comparison.periods.map((p) => (
                <Rating
                  key={p}
                  value={selectedSpecies.projections.find((r) => r.member === m.key && r.period === p)?.rating ?? null}
                />
              )),
            }))}
          />
          <p className="mt-3 text-xs text-muted-foreground">
            The selected model's period ratings:{' '}
            {modelProjections.map((r) => `${periodLabel(r.period)} ${ratingLabel(r.rating)}`).join(' → ')}.
          </p>
        </SidebarSection>
      )}
      {tab === 'bgc' && (
        <SidebarSection title="BGC and site-series changes">
          <p className="mb-3 text-sm">
            Baseline: {comparison.baseline?.bgc ?? 'No data'} · Observed{' '}
            {comparison.observed ? periodLabel(comparison.observed.period) : 'historical'}:{' '}
            {comparison.observed?.bgc ?? 'No data'}. Cells show the predicted BGC and its {condition} site-series
            lookup.
          </p>
          <ModelPeriodMatrix
            caption="BGC by model and period"
            periods={comparison.periods}
            rows={comparison.members.map((m) => ({
              label: memberLabel(m),
              values: comparison.periods.map((p) => {
                const bgc = comparison.projections.find((r) => memberKey(r) === m.key && r.period === p)?.bgc
                return (
                  <span key={p}>
                    {bgc ?? 'No data'}
                    <small className="block text-muted-foreground">
                      {bgc ? (data.reference.sites[bgc]?.[condition] ?? 'Site series not mapped') : '—'}
                    </small>
                  </span>
                )
              }),
            }))}
          />
        </SidebarSection>
      )}
      {tab === 'region' && (
        <SidebarSection title={`Regional outlook · ${regionId || 'No region'}`}>
          <SelectField
            label="Regional summary"
            fieldClassName="max-w-sm"
            value={regionId}
            onChange={(e) => setRegion(e.target.value)}
          >
            {data.manifest.regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label ?? r.id}
              </option>
            ))}
          </SelectField>
          <p className="my-3 text-sm">
            {selectedSpecies.species} · {member.model} · {member.run} · {legacyScenarioLabel(member.scenario)}. This
            named area is chosen independently of the map point.
          </p>
          <p className="my-2 text-xs text-muted-foreground">
            Persistence = retained suitable grid-cell count /{' '}
            {comparison.baseline ? periodLabel(comparison.baseline.period) : 'historical'} count. Expansion = newly
            suitable count / that same baseline. These are regional ratios, not point probabilities or hectares. A zero
            baseline gives no ratio.
          </p>
          {regionError ? (
            <InlineAlert tone="error">{regionError}</InlineAlert>
          ) : legacy.regionLoading ? (
            <InlineAlert loading>Loading regional summary…</InlineAlert>
          ) : (
            <RegionalTrendTable trends={trends} />
          )}
        </SidebarSection>
      )}
      {tab === 'silvics' && <Silvics species={selectedSpecies.species} />}
      {tab === 'report' && (
        <SidebarSection title="Export this analysis">
          <p className="text-sm">
            Both exports contain this location and site condition, baseline and observed BGCs, all{' '}
            {comparison.members.length} available model runs and {comparison.periods.length} periods for{' '}
            {comparison.species.length} species, plus the selected named-region outlook. The report includes the source
            and provisional-codebook limitation.
          </p>
          <p className="mt-2 text-sm">
            Regional selection: {regionId || 'None'} · {selectedSpecies.species} · {member.model} · {member.run} ·{' '}
            {legacyScenarioLabel(member.scenario)}. Choose Regional outlook to change it. Silvics reference tables are
            viewed separately and are not included in the calculation export.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            No Shiny CSV import or Shiny server is required. Open the downloaded HTML and use the browser's Print / Save
            as PDF command for a printable copy.
          </p>
        </SidebarSection>
      )}
      <DownloadActions
        actions={[
          {
            label: 'Download analysis JSON',
            disabled: !readyToExport,
            onClick: () =>
              downloadText(JSON.stringify(report, null, 2), 'cciss-legacy-analysis.json', 'application/json'),
          },
          {
            label: 'Download printable report',
            disabled: !readyToExport,
            onClick: () => downloadText(legacyComparisonHtml(report), 'cciss-legacy-comparison.html', 'text/html'),
          },
        ]}
      />
      {regionError && tab !== 'region' && (
        <InlineAlert tone="error">
          Regional data unavailable: {regionError}. <TextButton onClick={legacy.retry}>Retry</TextButton>
        </InlineAlert>
      )}
      <p className="text-xs text-muted-foreground">
        Source: Province of British Columbia, CCISS_ShinyApp / Development/OLD/spatial_app. Loaded numeric rasters are
        reused during this page session.
      </p>
    </div>
  )
}
