import { Button } from '@/components/ui/button'
import { InlineAlert, KeyValueRows } from '@/components/ui/map-panels'
import type { HistoricalCoverageNextStep, HistoricalCoverageSummary } from './accessHistorySummary'
import type { AccessHistoryQueryStatus, AccessHistorySelection } from './AccessHistorySelection'
import { Field, RoadSelect } from './Controls'
import type { Coordinate } from './types'

const sourceNames: Record<string, string> = {
  'results-opening': 'RESULTS opening',
  'ften-cutblock': 'FTEN cutblock',
  'ften-road-segment': 'FTEN road segments',
}
const nextSteps: Record<HistoricalCoverageNextStep, { message: string; action: string }> = {
  'load-block': { message: 'Load a cutblock to begin connecting its source records.', action: 'Open source records' },
  'load-roads': { message: 'Load the mapped road records around this block.', action: 'Open source records' },
  'place-entrance': {
    message: 'Set the actual entrance or landing used to reach this block.',
    action: 'Set access anchors',
  },
  'place-outlet': {
    message: 'Set an outlet where this access joins the established road network.',
    action: 'Set access anchors',
  },
  'resolve-evidence': {
    message: 'Review the missing dates or conflicting evidence before accepting historical access.',
    action: 'Review evidence gaps',
  },
  trace: {
    message: 'Trace from the saved block entrance to its network outlet at the chosen date.',
    action: 'Trace this block',
  },
  review: {
    message: 'Check the candidate against a map, haul record or other source, then record your conclusion.',
    action: 'Review route evidence',
  },
}

/** The selected block leads the workflow; full ledgers remain available below. */
export function AccessHistoryOverview({
  coverage,
  query,
  selection,
  disabled,
  onNext,
  onInspect,
  onLocate,
}: {
  coverage: HistoricalCoverageSummary
  query?: AccessHistoryQueryStatus | null
  selection?: Pick<AccessHistorySelection, 'kind' | 'id'> | null
  disabled: boolean
  onNext: (step: HistoricalCoverageNextStep) => void
  onInspect: (kind: 'road' | 'structure', id: string) => void
  onLocate?: (coordinates: Coordinate[]) => void
}) {
  const block = coverage.block
  const next = nextSteps[coverage.nextStep]
  const identities = coverage.identitySources.flatMap((source) => (source.blockIdentity ? [source.blockIdentity] : []))
  const values = (field: 'forestFileId' | 'cuttingPermitId' | 'cutBlockId' | 'timberMark' | 'clientNumber') =>
    [...new Set(identities.flatMap((identity) => (identity[field] ? [identity[field]!] : [])))].join(' / ') ||
    'not recorded'
  const evidence = coverage.harvest.evidence
  const recordOptions = [
    ...coverage.roads.map(({ feature }) => ({ value: `road:${feature.id}`, label: `Road · ${feature.name}` })),
    ...coverage.structures.map(({ structure }) => ({
      value: `structure:${structure.id}`,
      label: `${structure.kind} · ${structure.name}`,
    })),
  ]
  const selectedValue =
    selection && ['road', 'structure'].includes(selection.kind) ? `${selection.kind}:${selection.id}` : ''
  const latestQuery = query && (!query.blockId || query.blockId === block?.id) ? query : null
  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-2.5 text-xs" data-testid="history-block-overview">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="break-words font-medium">{block?.name ?? 'Connect a block to its source records'}</p>
          {block && (
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {evidence?.source === 'scenario'
                ? 'Synthetic teaching record'
                : evidence?.source === 'bc-ften' || evidence?.source === 'bc-consolidated'
                  ? 'Ministry source record'
                  : 'User-supplied block'}
              {evidence?.openingId ? ` · opening ${evidence.openingId}` : ' · opening ID not recorded'}
            </p>
          )}
        </div>
        {block?.geometry.type === 'Polygon' && onLocate && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              onLocate(
                block.geometry.type === 'Polygon'
                  ? block.geometry.coordinates[0].map(([x, y]) => [x, y] as Coordinate)
                  : [],
              )
            }
          >
            Locate block
          </Button>
        )}
      </div>
      {block && (
        <>
          <KeyValueRows
            variant="grid"
            rows={[
              { key: 'licence', label: 'Licence', value: values('forestFileId') },
              { key: 'permit', label: 'Cutting permit', value: values('cuttingPermitId') },
              { key: 'block', label: 'Source block', value: values('cutBlockId') },
              { key: 'mark', label: 'Timber mark', value: values('timberMark') },
              { key: 'client', label: 'Client', value: values('clientNumber') },
            ]}
          />
          <div className="space-y-1">
            <p className="font-medium">Harvest timing</p>
            <p>
              {coverage.harvest.label} · reference {coverage.asOf.slice(0, 4)}
            </p>
            {(evidence?.startDate || evidence?.endDate) && (
              <p className="text-2xs text-muted-foreground">
                Reported interval {evidence.startDate ?? 'start unknown'} – {evidence.endDate ?? 'completion unknown'}
                {evidence.yearMethod === 'estimated-range' ? ' · completion or range may be estimated' : ''}
              </p>
            )}
          </div>
          <div className="space-y-1 border-t pt-2" data-testid="history-connection-summary">
            <p className="font-medium">
              {coverage.scope === 'selected-path'
                ? `Selected route · ${coverage.asOf}`
                : 'Nearby loaded records · connection not established'}
            </p>
            <p>
              {coverage.roadCoverage.total} road record{coverage.roadCoverage.total === 1 ? '' : 's'} ·{' '}
              {coverage.structureCoverage.total} structure record{coverage.structureCoverage.total === 1 ? '' : 's'}
            </p>
            <p className="text-2xs text-muted-foreground">
              Roads with dated physical evidence:{' '}
              {coverage.roadCoverage.total - coverage.roadCoverage.withoutDatedPhysicalEvidence} /{' '}
              {coverage.roadCoverage.total}. {coverage.structureCoverage.matched} structure
              {coverage.structureCoverage.matched === 1 ? ' has' : 's have'} a resolved road attachment;{' '}
              {coverage.structureCoverage.withoutConstructionDate}{' '}
              {coverage.structureCoverage.withoutConstructionDate === 1 ? 'lacks' : 'lack'} construction dates.
            </p>
            {coverage.identity.entityCount > 0 && (
              <p className="text-2xs">
                {coverage.identity.entityCount} source{' '}
                {coverage.identity.entityCount === 1 ? 'entity shares' : 'entities share'} this opening ID.{' '}
                {coverage.identity.conflicts.length
                  ? `${coverage.identity.conflicts.length} identity field${coverage.identity.conflicts.length === 1 ? ' needs' : 's need'} reconciliation.`
                  : 'Road use is still a separate evidence question.'}
              </p>
            )}
          </div>
        </>
      )}
      <div className="space-y-1 border-t pt-2" data-testid="history-next-step">
        <p>
          <span className="font-medium">Next:</span> {next.message}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={disabled}
          onClick={() => onNext(coverage.nextStep)}
        >
          {next.action}
        </Button>
      </div>
      {latestQuery && (
        <InlineAlert tone={latestQuery.status === 'error' ? 'warning' : 'info'}>
          <span className="font-medium">Latest request:</span> {latestQuery.message}
        </InlineAlert>
      )}
      {block && (
        <details className="space-y-2" data-testid="history-coverage-gaps">
          <summary className="cursor-pointer font-medium">Evidence coverage and remaining gaps</summary>
          <ul className="list-disc space-y-1 pl-4">
            {coverage.queryCoverage.map((query) => (
              <li key={query.source}>
                {query.sourceRecord?.query?.requestUrl ? (
                  <a href={query.sourceRecord.query.requestUrl} target="_blank" rel="noreferrer" className="underline">
                    {sourceNames[query.source] ?? query.source}
                  </a>
                ) : (
                  (sourceNames[query.source] ?? query.source)
                )}
                :{' '}
                {query.status === 'success'
                  ? `${query.recordCount} record${query.recordCount === 1 ? '' : 's'} returned`
                  : query.status === 'skipped'
                    ? `not queried · ${query.sourceRecord?.query?.reason ?? 'prerequisite missing'}`
                    : 'no query result retained'}
                {query.sourceRecord && (
                  <span className="text-muted-foreground"> · {query.sourceRecord.retrievedAt.slice(0, 10)}</span>
                )}
              </li>
            ))}
            <li>
              Structure inventories: loaded by local file only; the open record queries do not check bridges or
              culverts.
            </li>
          </ul>
          {coverage.findings.map((finding) => (
            <p
              key={finding.id}
              className={finding.tone === 'warning' ? 'text-amber-800 dark:text-amber-300' : 'text-muted-foreground'}
            >
              {finding.message}
            </p>
          ))}
        </details>
      )}
      {recordOptions.length > 0 && (
        <Field
          label="Inspect road or structure"
          hint="Records in a saved route describe that route. When no current route is available, this list contains nearby loaded records; selecting or locating one does not assert that it served the block."
        >
          <RoadSelect
            ariaLabel="Inspect road or structure"
            value={recordOptions.some((option) => option.value === selectedValue) ? selectedValue : ''}
            placeholder="Choose a source record"
            disabled={disabled}
            options={recordOptions}
            onValueChange={(value) => {
              const kind = value.startsWith('structure:') ? 'structure' : 'road'
              onInspect(kind, value.slice(kind.length + 1))
            }}
          />
        </Field>
      )}
    </div>
  )
}
