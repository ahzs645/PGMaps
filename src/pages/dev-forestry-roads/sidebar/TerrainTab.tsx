import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, roadFieldClass, RoadSelect } from '../Controls'
import { RoadSection } from '../SidebarParts'
import { ConstraintsPanel } from '../ConstraintsPanel'
import { StreamsPanel } from '../StreamsPanel'
import { TerrainProfilesPanel } from '../TerrainProfilesPanel'
import type { PointCloudChoice, SidebarProps } from '../DesignSidebarBody'
import { NumberField } from '../Controls'
import { TerrainPreparationPanel } from '../TerrainPreparationPanel'
import { CutblockHistoryPanel } from '../CutblockHistoryPanel'
import { AccessHistoryPanel } from '../AccessHistoryPanel'
import { terrainDisplayName } from '../terrainName'

const SURFACES: Record<PointCloudChoice['surface'], string> = { mean: 'Ground cell mean', tin: 'TIN with breaklines' }
const CLASSIFY: Record<string, string> = {
  auto: "Use the file's; classify if none",
  true: 'Re-classify here',
  false: "Use the file's only",
}

const LIDAR_LINKS = [
  ['/dev/forestry/road-restoration', 'Local LiDAR restoration metrics'],
  ['/dev/lidar/forestry/', 'Forest structure & plots'],
  ['/dev/lidar/canopy/', 'Canopy heights & density'],
  ['/dev/lidar/trees/', 'Individual-tree inspection'],
  ['/dev/lidar/transects/', 'Source point-cloud transects'],
] as const

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
        <div className="rounded-md border bg-muted/20 px-2.5 py-2" data-testid="road-scenario-evidence">
          <div className="flex items-start gap-1.5">
            <p className="min-w-0 flex-1 text-sm font-medium leading-5" title={project.terrain.name}>
              {terrainSourceName(project.terrain.name)}
            </p>
            {project.terrain.kind === 'regional' && (
              <InfoTip label="Screening terrain" tone="warning" className="mt-0.5">
                Screening terrain. Use bare-earth LiDAR or your own DEM before relying on quantities.
              </InfoTip>
            )}
          </div>
          <p className="mt-0.5 text-2xs leading-4 text-muted-foreground">
            {terrainCellSize(project.terrain.resolutionM)} cells ·{' '}
            {project.terrain.epsg ? `EPSG:${project.terrain.epsg}` : 'training coordinates'}
            {project.scenario &&
              ` · ${count(project.context.filter((feature) => feature.kind === 'existing-road').length, 'road')} · ${count(project.context.filter((feature) => feature.kind === 'harvest').length, 'cutblock')}`}
          </p>
        </div>
        {project.scenario?.contextWarnings.map((warning, index) => (
          <InlineAlert key={index} tone="warning" className="mt-2">
            {warning}
          </InlineAlert>
        ))}
        <div className="mt-2 grid grid-cols-3 gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-auto min-h-8 whitespace-normal px-1 text-xs"
            aria-label="Load BC 1 m LiDAR sample"
            title="Classified-ground 1 m LiDAR DTM near Prince George"
            disabled={busy}
            onClick={() => p.onTerrain('lidar')}
          >
            BC LiDAR
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-auto min-h-8 whitespace-normal px-1 text-xs"
            disabled={busy}
            title="Coarse reconnaissance terrain, not a 1 m LiDAR source"
            onClick={() => p.onTerrain('regional')}
          >
            Regional DEM
          </Button>
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
        <Button variant="outline" size="sm" className="mt-1 w-full" onClick={() => p.onFile('terrain')} disabled={busy}>
          <Upload className="mr-2 size-3" />
          Import GeoTIFF, LAS or LAZ
        </Button>
      </RoadSection>
      <StreamsPanel
        workspace={p.workspace}
        onDraw={() => p.onMode('stream')}
        onImport={() => p.onFile('context')}
        onProfile={p.onProfile}
      />
      <ConstraintsPanel
        workspace={p.workspace}
        onDraw={() => p.onMode('avoid')}
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
      />
      <AccessHistoryPanel
        workspace={p.workspace}
        onLocate={p.onLocateHistory}
        selection={p.historySelection}
        onInspectRecord={p.onInspectHistoryRecord}
        onSelectBlock={p.onSelectHistoryBlock}
      />
      <TerrainProfilesPanel workspace={p.workspace} onDraw={() => p.onMode('profile')} onProfile={p.onProfile} />
      <RoadSection
        title="Import options"
        summary={`${SURFACES[p.pointCloud.surface]}${p.verticalReference ? ' · datum set' : ''}`}
        help={
          <>
            <b>GeoTIFF:</b> single-band bare-earth elevations in metres, up to 4.19 million native cells / 64 MB, with
            resolution and no-data preserved.
            <br />
            <b>LAS or LAZ</b> (up to 1 GB): needs a projected CRS key; the vertical datum comes from the file or the
            field here. Ground points are gridded to about 1 m, as a cell mean (gaps up to 3 cells filled) or as a TIN
            that keeps breaklines such as ditch bottoms, stream banks and road edges. Unclassified clouds are classified
            here at about 55,000 points a second, so a million points takes about 20 s.
          </>
        }
      >
        <Field label="Imported DEM vertical datum (metres)">
          <input
            className={roadFieldClass}
            value={p.verticalReference}
            placeholder="e.g. CGVD2013 / EPSG:6647"
            onChange={(e) => p.onVerticalReference(e.target.value)}
          />
        </Field>
        <details className="group rounded-md border" data-testid="road-point-cloud-options">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-xs [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            <span className="font-medium">Point-cloud options</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {SURFACES[p.pointCloud.surface]}
              {p.breaklines ? ` · ${p.breaklines}` : ''}
            </span>
          </summary>
          <div className="space-y-2 border-t p-2">
            <Field label="Point-cloud surface">
              <RoadSelect
                ariaLabel="Point-cloud surface"
                className={roadFieldClass}
                value={p.pointCloud.surface}
                onValueChange={(value) =>
                  p.onPointCloud({ ...p.pointCloud, surface: value as PointCloudChoice['surface'] })
                }
              >
                {Object.entries(SURFACES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </RoadSelect>
            </Field>
            <Field
              label="Ground classification"
              hint="Unclassified clouds are classified in the browser with WhiteboxTools' ground point filter."
            >
              <RoadSelect
                ariaLabel="Ground classification"
                className={roadFieldClass}
                value={String(p.pointCloud.classify)}
                onValueChange={(value) =>
                  p.onPointCloud({
                    ...p.pointCloud,
                    classify: value === 'auto' ? 'auto' : value === 'true',
                  })
                }
              >
                {Object.entries(CLASSIFY).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </RoadSelect>
            </Field>
            {p.pointCloud.surface === 'tin' && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => p.onFile('breaklines')}
                  disabled={busy}
                >
                  {p.breaklines ? 'Replace breaklines' : 'Add breaklines (GeoJSON)'}
                </Button>
                <InfoTip label="About breaklines">
                  Lines with Z, a <code>z</code> property, or draped on the ground. The next TIN import keeps them as
                  hard edges.
                </InfoTip>
                {p.breaklines && (
                  <Button variant="ghost" size="sm" onClick={p.onClearBreaklines} title={p.breaklines}>
                    Clear
                  </Button>
                )}
              </div>
            )}
            <NumberField
              label="Preserve road corridor each side (m; 0 disables)"
              hint="Points inside the active road corridor keep full density. Outside it, thinning respects the worker's point budget; a corridor larger than the budget fails."
              value={p.pointCloud.preserveCorridorM ?? 0}
              min={0}
              max={1000}
              onChange={(v) => p.onPointCloud({ ...p.pointCloud, preserveCorridorM: v })}
            />
            {p.pointCloud.surface === 'tin' && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={p.pointCloud.retainTin ?? false}
                  onChange={(e) => p.onPointCloud({ ...p.pointCloud, retainTin: e.target.checked })}
                />
                Retain source TIN for LandXML (250,000 vertices)
              </label>
            )}
          </div>
        </details>
      </RoadSection>
      <TerrainPreparationPanel
        workspace={p.workspace}
        verticalReference={p.verticalReference}
        pointCloud={p.pointCloud}
      />
      {existingRoads}
      <RoadSection
        title="Related LiDAR workspaces"
        summary="5 tools"
        help="These open the published BC sample's canopy and tree products in a new tab; the road project stays open here. The ground DEM cannot provide DBH, species or merchantable volume, and an imported DEM is not relabelled as an inventory dataset."
      >
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
          {LIDAR_LINKS.map(([to, label]) => (
            <Link key={to} className="truncate text-primary underline" to={to} target="_blank" title={label}>
              {label}
            </Link>
          ))}
        </div>
      </RoadSection>
    </>
  )
}
