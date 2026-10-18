import { Download } from 'lucide-react'
import { SidebarSection } from '@/components/ui/map-panels'
import { StatGroup } from '@/components/ui/stat-group'
import { formatNumber } from '@/lib/format'
import type { AnalysisSummary, RasterKey } from './types'

export function LidarResults({
  summary,
  analysisBase,
  selectRaster,
}: {
  summary: AnalysisSummary
  analysisBase: string
  selectRaster: (key: RasterKey) => void
}) {
  return (
    <>
      <SidebarSection title="Tile results" subtitle="BC 093G086 · unvalidated candidates">
        <StatGroup
          variant="tiles"
          size="sm"
          columns={2}
          items={[
            {
              label: 'Observed footprint',
              value: `${summary.observed_area_ha.toFixed(1)} ha`,
              note: '84,608,005 source points',
            },
            {
              label: 'Elevated-return cover',
              value: `${summary.elevated_first_return_cover_percent.toFixed(1)}%`,
              note: 'Returns >2 m; includes structures',
            },
            {
              label: 'Median elevated height',
              value: `${summary.elevated_surface_height_stats_m.median.toFixed(1)} m`,
              note: 'Cells >2 m; roof candidates excluded',
            },
            {
              label: 'Crown candidates',
              value: formatNumber(summary.tree_candidate_count),
              note: 'Local maxima + watershed',
            },
            {
              label: 'Roof-like patches',
              value: formatNumber(summary.building_candidate_count),
              note: 'Planar patches; not building count',
            },
            {
              label: 'Ground-supported area',
              value: `${summary.ground_supported_percent.toFixed(2)}%`,
              note: 'Height estimates with terrain support',
            },
          ]}
        />
      </SidebarSection>
      <SidebarSection title="Processed surfaces" subtitle="Select a preview to show it on the map.">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['height', 'Height above ground'],
              ['terrain', 'Ground terrain'],
              ['slope', 'GeoLibre slope'],
              ['crowns', 'Crown regions'],
            ] as const
          ).map(([key, title]) => (
            <button
              type="button"
              key={key}
              onClick={() => selectRaster(key)}
              className="overflow-hidden rounded-lg border text-left hover:border-emerald-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              <img
                src={new URL(summary.rasters[key].file, analysisBase).href}
                alt={`${title} computed from the supplied LiDAR tile`}
                className="h-20 w-full bg-slate-950 object-contain"
                loading="lazy"
              />
              <span className="block p-2 text-[11px] font-medium">{title}</span>
            </button>
          ))}
        </div>
      </SidebarSection>
      <SidebarSection title="Return-height profile" subtitle="Share of valid returns; not biomass or fuel load.">
        <div className="space-y-2">
          {summary.return_height_profile.counts.map((count, i, counts) => {
            const percent = (count / counts.reduce((a, b) => a + b, 0)) * 100
            return (
              <div key={i} className="grid grid-cols-[52px_1fr_38px] items-center gap-2 text-[10px]">
                <span>{summary.return_height_profile.bins_m[i]} m</span>
                <span className="h-2 rounded bg-muted">
                  <span className="block h-2 rounded bg-emerald-600" style={{ width: `${percent}%` }} />
                </span>
                <span className="text-right tabular-nums">{percent.toFixed(1)}%</span>
              </div>
            )
          })}
        </div>
      </SidebarSection>
    </>
  )
}

export function LidarMethods({ summary }: { summary: AnalysisSummary }) {
  return (
    <>
      <SidebarSection title="How to use these views">
        <div className="space-y-3 text-xs leading-5 text-muted-foreground">
          <p>
            <strong className="text-foreground">Canopy review:</strong> compare height and crown candidates with
            imagery; use the eye button to reveal individual crowns. Missed understory and merged or split crowns
            require validation.
          </p>
          <p>
            <strong className="text-foreground">Roof review:</strong> compare planar patches with imagery edges, then
            inspect the original 3D points. A roof may have several patches; a tall object is not automatically a
            building.
          </p>
          <p>
            <strong className="text-foreground">Terrain quality:</strong> inspect ground-support distance before using
            normalized heights in sparsely supported areas.
          </p>
          <p>
            Vector roads and OSM building footprints provide orientation. Imagery provides visual evidence at a
            different date. Neither independently establishes tree counts, species or height accuracy.
          </p>
        </div>
        <div className="mt-3 space-y-2 text-xs underline">
          <a
            className="block"
            href="https://r-lidar.github.io/lidRbook/itd.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            lidR: detection, segmentation and parameter sensitivity ↗
          </a>
          <a
            className="block"
            href="https://r-lidar.github.io/lidRbook/dsm.html"
            target="_blank"
            rel="noopener noreferrer"
          >
            lidR: canopy-height models ↗
          </a>
          <a className="block" href="https://openfreemap.org/quick_start/" target="_blank" rel="noopener noreferrer">
            OpenFreeMap vector context ↗
          </a>
        </div>
      </SidebarSection>
      <SidebarSection title="Processing methods">
        <div className="space-y-3 text-xs leading-5 text-muted-foreground">
          <p>
            <strong className="text-foreground">Full tile:</strong> noise/overlap-class exclusion; 1 m ground and
            surface grids; bounded ground TIN filling; height above ground; local maxima and watershed crowns; planar,
            single-return roof screening.
          </p>
          <p>
            <strong className="text-foreground">Actual GeoLibre engine:</strong>{' '}
            {summary.geolibre?.tools.join(', ') || 'See downloadable execution record'}. {summary.geolibre?.tree_scope}
          </p>
          <p>
            Minimum crown separation changes detection:{' '}
            {summary.tree_detection_sensitivity
              .map((s) => `${s.minimum_separation_m} m → ${formatNumber(s.local_maxima)} peaks`)
              .join('; ')}
            . These are algorithm outputs, not confidence intervals or verified tree totals.
          </p>
          <p>
            The source contains ground and unclassified points, with no vegetation or building labels. Height above
            ground is a canopy-height proxy; structures remain.
          </p>
          <p>
            Web previews use a resampled 3 m grid; downloads retain the 1 m UTM grid. Point-cloud scene Z is shifted for
            viewing; source elevations are retained.
          </p>
        </div>
      </SidebarSection>
      <SidebarSection title="Interpretation & limits">
        <ul className="list-disc space-y-2 pl-4 text-xs leading-5 text-muted-foreground">
          {summary.limitations.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </SidebarSection>
    </>
  )
}

export function LidarDownloads({ summary, analysisBase }: { summary: AnalysisSummary; analysisBase: string }) {
  return (
    <>
      <SidebarSection title="Download products" subtitle="Source-grid rasters, candidates and execution records.">
        <div className="space-y-2">
          {summary.downloads.map((download) => (
            <a
              key={download.file}
              className="flex items-center gap-2 rounded border px-3 py-2 text-xs hover:bg-muted"
              href={new URL(download.file, analysisBase).href}
              download
            >
              <Download className="size-3.5 shrink-0" />
              {download.label}
            </a>
          ))}
        </div>
      </SidebarSection>
      <SidebarSection title="Source & maintenance">
        <p className="mb-3 text-xs leading-5 text-muted-foreground">
          The versioned processing pipeline generates the products consumed by this viewer. Heavy analysis runs outside
          page load.
        </p>
        <div className="space-y-3 text-xs underline">
          {[
            ['Original LAZ on Drive', 'https://drive.google.com/file/d/12HM0-w7PNe_cC1t-ThLrFoBZngr4jgfI/view'],
            ['GeoLibre', 'https://github.com/opengeos/GeoLibre'],
            ['LiDAR rendering component', 'https://github.com/opengeos/maplibre-gl-lidar'],
            ['Processing engine', 'https://github.com/opengeos/geolibre-rust'],
            ['RustGIS companion', 'https://github.com/opengeos/RustGIS'],
            ['PGMaps source · PR #37', 'https://github.com/ahzs645/PGMaps/pull/37'],
          ].map(([label, href]) => (
            <a key={href} className="block" href={href} target="_blank" rel="noopener noreferrer">
              {label} ↗
            </a>
          ))}
        </div>
      </SidebarSection>
    </>
  )
}
