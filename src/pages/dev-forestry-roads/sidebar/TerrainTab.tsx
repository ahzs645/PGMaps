import { CommandButton, type CommandPresentation } from '@/components/interfaces/CommandButton'
import type { WorkspaceCommand } from '@/components/interfaces/workspaceCommands'
import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { CollapsibleSection, KeyValueRows } from '@/components/ui/map-panels'
import { RoadSection } from '../SidebarParts'
import { ConstraintsPanel } from '../ConstraintsPanel'
import { StreamsPanel } from '../StreamsPanel'
import { TerrainProfilesPanel } from '../TerrainProfilesPanel'
import { SURFACES, TerrainImportField } from '../SharedRoadFields'
import type { SidebarProps } from '../DesignSidebarBody'
import { TerrainPreparationPanel } from '../TerrainPreparationPanel'
import { CutblockHistoryPanel } from '../CutblockHistoryPanel'
import { AccessHistoryPanel } from '../AccessHistoryPanel'
import { terrainDisplayName } from '../terrainName'
import { TerrainCaveats } from '../TerrainCaveats'
import { pointCloudImportSummary } from '../terrain'

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`
/** A cell size people read at a glance: whole metres when coarse, decimals only when they matter. */
const terrainCellSize = (m: number) =>
  m >= 10 ? `${Math.round(m)} m` : m >= 1 ? `${m.toFixed(1)} m` : `${m.toFixed(2)} m`
/** The source name without its bounding box or a quality note the warning icon already carries. */
const terrainSourceName = (name: string) =>
  terrainDisplayName(name)
    .split(' · ')
    .filter((part) => part !== 'coarse screening')
    .join(' · ')

export function TerrainTab({ existingRoads, ...p }: SidebarProps & { existingRoads: ReactNode }) {
  const { project } = p.workspace
  const busy = !!p.workspace.busy
  // Terrain sources, terrain import and drawing are the registry's commands (`workspaceCommands.ts`).
  const run = (id: WorkspaceCommand) => p.onCommand?.(id)
  const sourceTool = (id: WorkspaceCommand, presentation: CommandPresentation) => (
    <CommandButton
      id={id}
      surface="sidebar"
      state={p.commandStates?.[id]}
      presentation={{ hideIcon: true, className: 'h-auto min-h-8 whitespace-normal text-xs', ...presentation }}
      onRun={run}
    />
  )
  const importSummary = pointCloudImportSummary(project.terrain)
  return (
    <>
      <RoadSection
        title="Terrain source"
        help={
          <>
            The road samples this terrain for every profile, section and quantity. The BC sample is a classified-ground
            1 m LiDAR DTM. Regional DEM is coarse reconnaissance terrain; the training example is synthetic.
            <br />
            Vertical reference: {project.terrain.verticalReference}.
            <br />
            Concept planning only: earthworks use average end areas, and construction needs field and engineering
            review.
            {project.scenario && (
              <>
                <br />
                {project.scenario.terrainCoveragePercent.toFixed(0)}% of the sampled section corridor had ground at
                load. Public road tenures do not include every built road.
              </>
            )}
          </>
        }
      >
        {/* The source by name: a bounding box and raw cell size are kept for the tooltip and report. */}
        <div className={insetBox({ tone: 'muted' })} data-testid="road-scenario-evidence">
          <div className="flex items-start gap-1.5">
            <p className="min-w-0 flex-1 text-sm font-medium leading-5" title={project.terrain.name}>
              {terrainSourceName(project.terrain.name)}
            </p>
            <TerrainCaveats
              screening={project.terrain.kind === 'regional'}
              warnings={project.scenario?.contextWarnings ?? []}
              className="mt-0.5"
            />
          </div>
          <p className="mt-0.5 text-2xs leading-4 text-muted-foreground">
            {terrainCellSize(project.terrain.resolutionM)} cells ·{' '}
            {project.terrain.epsg ? `EPSG:${project.terrain.epsg}` : 'training coordinates'}
            {project.scenario &&
              ` · ${count(project.context.filter((feature) => feature.kind === 'existing-road').length, 'road')} · ${count(project.context.filter((feature) => feature.kind === 'harvest').length, 'cutblock')}`}
          </p>
          {/* The point-cloud import summary stays with the terrain: its notice is gone in seconds. */}
          {importSummary && (
            <div className="-mx-2.5 -mb-2 mt-1.5" data-testid="road-terrain-import-summary">
              <CollapsibleSection
                label="Import summary"
                summary={importSummary[0].value}
                summaryWhenCollapsedOnly
                className="border-b-0 border-t bg-transparent"
                contentClassName="px-2.5 pb-2"
              >
                <KeyValueRows
                  variant="grid"
                  valueClassName="tabular-nums font-normal"
                  rows={importSummary.map((row) => ({ key: row.label, label: row.label, value: row.value }))}
                />
              </CollapsibleSection>
            </div>
          )}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1">
          {sourceTool('lidar', {
            caption: 'BC LiDAR',
            ariaLabel: 'Load BC 1 m LiDAR sample',
          })}
          {sourceTool('regional', {
            caption: 'Regional DEM',
          })}
          <Button
            variant="outline"
            size="sm"
            className="h-auto min-h-8 whitespace-normal px-1 text-xs"
            aria-label="Training example"
            disabled={busy}
            onClick={() => p.onTerrain('demo')}
          >
            Training
          </Button>
        </div>
        <div className="mt-1 grid">
          {sourceTool('detailedDem', {})}
          <CommandButton
            id="import"
            surface="sidebar"
            state={p.commandStates?.import}
            presentation={{ caption: 'Import GeoTIFF, LAS or LAZ' }}
            onRun={run}
          />
        </div>
      </RoadSection>
      <StreamsPanel
        workspace={p.workspace}
        onDraw={() => run('drawStream')}
        onImport={() => p.onFile('context')}
        onProfile={p.onProfile}
      />
      <ConstraintsPanel
        workspace={p.workspace}
        onDraw={() => run('drawAvoid')}
        onLocate={p.onLocateConstraint}
        focusedId={p.focusedConstraintId}
      />
      <CutblockHistoryPanel
        workspace={p.workspace}
        onLocate={p.onLocateConstraint}
        focusedId={p.focusedConstraintId}
        reviewRequest={p.cutblockReviewRequest}
        onDraw={p.onDrawBlock}
        onReviewRoad={(road) => {
          p.onLocateRoad?.(road)
          p.onOpenRoadHistory?.(road.id)
        }}
        onImportFile={p.onImportSpatial ? (file) => p.onImportSpatial!(file, 'cutblocks') : undefined}
      />
      {sourceTool('importReference', {})}
      <AccessHistoryPanel
        workspace={p.workspace}
        onLocate={p.onLocateHistory}
        selection={p.historySelection}
        onInspectRecord={p.onInspectHistoryRecord}
        onSelectBlock={p.onSelectHistoryBlock}
        onLoadAsRoad={p.onLoadMappedRoad}
      />
      <TerrainProfilesPanel workspace={p.workspace} onDraw={() => p.onMode('profile')} onProfile={p.onProfile} />
      <RoadSection
        title="Import options"
        summary={`${SURFACES[p.pointCloud.surface]}${p.verticalReference ? ' · datum set' : ''}`}
        help={
          <>
            <b>GeoTIFF:</b> single-band bare-earth elevations in metres, up to 4.19 million native cells / 64 MB, with
            resolution and no-data preserved. Its vertical datum is the field here, or asked for at import.
            <br />
            <b>LAS or LAZ</b> (up to 12 tiles, 1 GB in all): a cloud with no CRS is asked for its EPSG code. The
            vertical datum comes from the field here or the file; with neither, the import asks. Ground points are
            gridded to about 1 m, as a cell mean (gaps up to 3 cells filled) or as a TIN that keeps breaklines such as
            ditch bottoms, stream banks and road edges. Unclassified clouds are classified here at about 55,000 points a
            second, so a million points takes about 20 s.
          </>
        }
      >
        <TerrainImportField field="importDatum" {...p} />
        <details className={cn(insetBox({ padding: 'none' }), 'group')} data-testid="road-point-cloud-options">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-xs [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            <span className="font-medium">Point-cloud options</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {SURFACES[p.pointCloud.surface]}
              {p.breaklines ? ` · ${p.breaklines}` : ''}
            </span>
          </summary>
          <div className="space-y-2 border-t p-2">
            <TerrainImportField field="cloudSurface" {...p} />
            <TerrainImportField field="cloudClass" {...p} />
            {p.pointCloud.surface === 'tin' && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => p.onFile('breaklines')}
                  disabled={busy}
                >
                  {p.breaklines ? 'Replace breaklines' : 'Add breaklines'}
                </Button>
                <InfoTip label="About breaklines">
                  GeoJSON, a zipped shapefile, KML or KMZ. Lines with Z, a <code>z</code> property, or draped on the
                  ground; KML altitude is not read. The next TIN import keeps them as hard edges.
                </InfoTip>
                {p.breaklines && (
                  <Button variant="ghost" size="sm" onClick={p.onClearBreaklines} title={p.breaklines}>
                    Clear
                  </Button>
                )}
              </div>
            )}
            <TerrainImportField field="preserveCorridorM" {...p} />
            {p.pointCloud.surface === 'tin' && <TerrainImportField field="retainTin" {...p} />}
          </div>
        </details>
      </RoadSection>
      <TerrainPreparationPanel
        workspace={p.workspace}
        verticalReference={p.verticalReference}
        pointCloud={p.pointCloud}
        onAskTerrain={p.onAskTerrain}
      />
      {existingRoads}
    </>
  )
}
