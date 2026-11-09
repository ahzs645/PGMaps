import { SelectField } from '@/components/ui/form-field'
import { SidebarSection } from '@/components/ui/map-panels'
import { AnalysisTable } from './AnalysisTable'
import type { CurrentAssessment } from './currentAnalysis'
import { percentOrNoData, speciesSummaries, speciesSummaryTable } from './currentAnalysisTables'
import type { SpeciesReport } from './shinyReport'

export function CurrentSpeciesView({
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
  return (
    <div className="space-y-4">
      <SidebarSection title="Species suitability">
        <AnalysisTable textColumns={4} table={speciesSummaryTable(assessment, speciesSummaries(assessment))} />
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
            <AnalysisTable
              textColumns={1}
              table={{
                title: 'Current species vote proportions',
                columns: ['Period', 'High', 'Moderate', 'Low', 'Unsuitable', 'Novel climate'],
                rows: Object.keys(selected.votes)
                  .sort()
                  .map((period) => [
                    period,
                    ...[0, 1, 2, 3].map((index) => percentOrNoData(selected.votes[period]?.[index])),
                    percentOrNoData(selected.novelty[period]),
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
