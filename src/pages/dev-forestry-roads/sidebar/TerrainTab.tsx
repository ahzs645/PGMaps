import { NativeSelect } from '@/components/ui/form-field'
import { Link } from 'react-router-dom'
import { ChevronRight, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { Field, OptionalNumberField, roadFieldClass } from '../Controls'
import { RoadSection } from '../SidebarParts'
import type { PointCloudChoice, SidebarProps } from '../DesignSidebarBody'
import { NumberField } from '../Controls'
import { TerrainPreparationPanel } from '../TerrainPreparationPanel'

const SURFACES: Record<PointCloudChoice['surface'], string> = { mean: 'Ground cell mean', tin: 'TIN with breaklines' }
const CLASSIFY: Record<string, string> = {
  auto: "Use the file's; classify if none",
  true: 'Re-classify here',
  false: "Use the file's only",
}

const LIDAR_LINKS = [
  ['/dev/lidar/forestry/', 'Forest structure & plots'],
  ['/dev/lidar/canopy/', 'Canopy heights & density'],
  ['/dev/lidar/trees/', 'Individual-tree inspection'],
  ['/dev/lidar/transects/', 'Source point-cloud transects'],
] as const

export function TerrainTab(p: SidebarProps) {
  const { project, update } = p.workspace
  const busy = !!p.workspace.busy
  return (
    <>
      <RoadSection
        title="Terrain source"
        help="The road samples this terrain for every profile, section and quantity. The BC sample is a classified-ground 1 m LiDAR DTM. Regional DEM is coarse reconnaissance terrain, not a 1 m LiDAR source; the training example is synthetic."
      >
        <div className="rounded-md border bg-muted/20 px-2.5 py-2">
          <p className="text-sm font-medium leading-5">{project.terrain.name}</p>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
            {project.terrain.resolutionM.toFixed(2)} m cells ·{' '}
            {project.terrain.epsg ? `EPSG:${project.terrain.epsg}` : 'training coordinates'} ·{' '}
            {project.terrain.verticalReference}
          </p>
        </div>
        {project.terrain.kind === 'regional' && (
          <InlineAlert tone="warning" className="mt-2">
            Regional terrain supports corridor screening. Use checked bare-earth LiDAR or your own DEM before relying on
            earthwork quantities, ditches or culvert cover.
          </InlineAlert>
        )}
        {project.scenario && (
          <div className="mt-2 space-y-1.5 text-[11px] text-muted-foreground" data-testid="road-scenario-evidence">
            <p>
              Initial library terrain check · {project.scenario.terrainCoveragePercent.toFixed(0)}% of sampled
              section-corridor ground covered at load. Current section completeness is shown in the summary above.
            </p>
            <p>
              Context in this project: {project.context.filter((feature) => feature.kind === 'existing-road').length}{' '}
              road sections · {project.context.filter((feature) => feature.kind === 'harvest').length} harvest polygons.
              Public road tenures do not include every built road.
            </p>
            {project.scenario.contextWarnings.map((warning, index) => (
              <InlineAlert key={index} tone="warning">
                {warning}
              </InlineAlert>
            ))}
          </div>
        )}
        <Button className="mt-2 w-full" size="sm" disabled={busy} onClick={() => p.onTerrain('lidar')}>
          Load BC 1 m LiDAR sample
        </Button>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            title="Coarse reconnaissance terrain, not a 1 m LiDAR source"
            onClick={() => p.onTerrain('regional')}
          >
            Regional DEM
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => p.onTerrain('demo')}>
            Training example
          </Button>
        </div>
      </RoadSection>
      <RoadSection
        title="Import terrain"
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
        <div className="space-y-2">
          <Field label="Imported DEM vertical datum (metres)">
            <input
              className={roadFieldClass}
              value={p.verticalReference}
              placeholder="e.g. CGVD2013 / EPSG:6647"
              onChange={(e) => p.onVerticalReference(e.target.value)}
            />
          </Field>
          <Button variant="outline" size="sm" className="w-full" onClick={() => p.onFile('terrain')} disabled={busy}>
            <Upload className="mr-2 size-3" />
            Import GeoTIFF, LAS or LAZ
          </Button>
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
                <NativeSelect
                  className={roadFieldClass}
                  value={p.pointCloud.surface}
                  onChange={(e) =>
                    p.onPointCloud({ ...p.pointCloud, surface: e.target.value as PointCloudChoice['surface'] })
                  }
                >
                  {Object.entries(SURFACES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field
                label="Ground classification"
                hint="Unclassified clouds are classified in the browser with WhiteboxTools' ground point filter."
              >
                <NativeSelect
                  className={roadFieldClass}
                  value={String(p.pointCloud.classify)}
                  onChange={(e) =>
                    p.onPointCloud({
                      ...p.pointCloud,
                      classify: e.target.value === 'auto' ? 'auto' : e.target.value === 'true',
                    })
                  }
                >
                  {Object.entries(CLASSIFY).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </NativeSelect>
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
                value={p.pointCloud.preserveCorridorM ?? 0}
                min={0}
                max={1000}
                onChange={(v) => p.onPointCloud({ ...p.pointCloud, preserveCorridorM: v })}
              />
              <p className="text-[11px] text-muted-foreground">
                Points inside the active road corridor retain full density. Outside it, thinning respects the worker's
                point budget; a corridor larger than the budget fails explicitly.
              </p>
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
        </div>
      </RoadSection>
      <TerrainPreparationPanel
        workspace={p.workspace}
        verticalReference={p.verticalReference}
        pointCloud={p.pointCloud}
      />
      <RoadSection
        title="Context & terrain profiles"
        help="Import GeoJSON or a zipped shapefile; a GeoJSON kind of stream, avoid, existing-road or harvest sets how each feature is used. Click a line to sample it as a terrain profile. An avoidance area with a zone cost lets the route search cross it at that extra cost per metre; empty blocks it."
      >
        <Button variant="outline" size="sm" className="w-full" onClick={() => p.onFile('context')}>
          <Upload className="mr-2 size-3" />
          Import streams / constraints
        </Button>
        <div className="mt-2 grid grid-cols-[auto_repeat(3,minmax(0,1fr))] items-center gap-1">
          <span className="pr-1 text-xs text-muted-foreground">Draw</span>
          <Button
            variant="outline"
            size="sm"
            className="px-1 text-xs"
            aria-label="Draw terrain profile"
            title="Draw terrain profile"
            onClick={() => p.onMode('profile')}
          >
            Profile
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="px-1 text-xs"
            aria-label="Draw stream"
            title="Draw stream"
            onClick={() => p.onMode('stream')}
          >
            Stream
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="px-1 text-xs"
            aria-label="Draw avoidance area"
            title="Draw avoidance area"
            onClick={() => p.onMode('avoid')}
          >
            Avoid area
          </Button>
        </div>
        {(project.context.length > 0 || (project.profiles ?? []).length > 0) && (
          <div className="mt-2 space-y-1">
            {project.context.map((feature) => (
              <div key={feature.id} className="flex items-center gap-1 rounded border px-2 py-1">
                <button
                  className="min-w-0 flex-1 truncate text-left text-xs"
                  disabled={feature.geometry.type !== 'LineString'}
                  onClick={() => p.onProfile(feature.id)}
                >
                  {feature.name} <span className="text-muted-foreground">· {feature.kind}</span>
                </button>
                {feature.kind === 'avoid' && feature.geometry.type === 'Polygon' && (
                  <div className="w-20" title="Empty blocks the route search; a value lets it cross at this extra cost">
                    <OptionalNumberField
                      label={`${feature.name} zone cost per metre`}
                      hideLabel
                      placeholder="blocked"
                      value={feature.routeCostPerM ?? null}
                      min={0}
                      max={1e6}
                      step={10}
                      onChange={(cost) =>
                        update((x) => ({
                          ...x,
                          context: x.context.map((c) => {
                            if (c.id !== feature.id) return c
                            const { routeCostPerM: _old, ...rest } = c
                            void _old
                            return cost === null ? rest : { ...rest, routeCostPerM: cost }
                          }),
                        }))
                      }
                    />
                  </div>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={`Remove context ${feature.name}`}
                  onClick={() => update((x) => ({ ...x, context: x.context.filter((c) => c.id !== feature.id) }))}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
            {(project.profiles ?? []).map((profile) => (
              <div key={profile.id} className="flex items-center gap-1 rounded border px-2 py-1">
                <button className="flex-1 text-left text-xs" onClick={() => p.onProfile(profile.id)}>
                  {profile.name}
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={`Remove profile ${profile.name}`}
                  onClick={() => update((x) => ({ ...x, profiles: x.profiles?.filter((v) => v.id !== profile.id) }))}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </RoadSection>
      <RoadSection
        title="Related LiDAR workspaces"
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
