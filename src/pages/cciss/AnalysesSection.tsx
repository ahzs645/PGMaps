import { FileJson, FileSpreadsheet, GitCompareArrows, History, type LucideIcon } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { CollapsibleSection, SidebarSection } from '@/components/ui/map-panels'
import { ExternalLink } from '@/components/ui/text-button'
import type { CcissAnalysisMode } from './workspace'

type OpenMode = Exclude<CcissAnalysisMode, null>

const LAUNCHERS: { mode: OpenMode; label: string; icon: LucideIcon; description: string }[] = [
  {
    mode: 'report',
    label: 'Open species report',
    icon: FileSpreadsheet,
    description: 'Read and reweight a published or exported Shiny result.',
  },
  {
    mode: 'legacy',
    label: 'Open legacy analysis',
    icon: History,
    description: 'Species suitability at the map point from the older numeric dataset.',
  },
  {
    mode: 'current',
    label: 'Open current data analysis',
    icon: FileJson,
    description: 'Assess an imported CCISS site-data bundle. The file stays in this browser.',
  },
]

function Launcher({
  label,
  icon: Icon,
  description,
  onOpen,
}: {
  label: string
  icon: LucideIcon
  description: string
  onOpen: () => void
}) {
  const id = useId()
  return (
    <li>
      <Button variant="outline" size="sm" className="w-full justify-start" aria-describedby={id} onClick={onOpen}>
        <Icon className="mr-1.5 size-4" aria-hidden="true" />
        {label}
      </Button>
      <p id={id} className="mt-1 text-xs text-muted-foreground">
        {description}
      </p>
    </li>
  )
}

/** Each analysis opens in its own dialog; the map point feeds the legacy and current analyses. */
export function AnalysesSection({
  onOpen,
  comparisonCount,
}: {
  onOpen: (mode: OpenMode) => void
  comparisonCount: number
}) {
  return (
    <SidebarSection title="Analyses">
      <ul className="space-y-2.5">
        {LAUNCHERS.map((launcher) => (
          <Launcher key={launcher.mode} {...launcher} onOpen={() => onOpen(launcher.mode)} />
        ))}
        <Launcher
          label={`Open comparisons (${comparisonCount})`}
          icon={GitCompareArrows}
          description="Results saved from any analysis, side by side. They stay until the page closes."
          onOpen={() => onOpen('compare')}
        />
      </ul>
    </SidebarSection>
  )
}

/** Background a reader needs once: what the public data cannot do, and where the rest of CCISS lives. */
export function AboutSection() {
  return (
    <CollapsibleSection
      label="About CCISS data and sources"
      collapseOn="always"
      contentClassName="space-y-2 px-3 pb-3 text-xs text-muted-foreground"
    >
      <p>
        The values above are province-wide raster cells. CCISS’s site-specific report also needs the point’s site
        series, member-by-member BGC predictions, edatopic overlap, suitability tables, and model weights. Those
        prediction arrays are not included in the public map tiles or GeoTIFF downloads.
      </p>
      <p>
        Open current data analysis to import a version-matched export. Its available sites, climate models and site
        series determine the calculation options. Complete reference tables are required for species suitability; a
        predictions-only export supports BGC probabilities.
      </p>
      <p>
        CCISS also has site selection, a detailed and summary suitability report, BEC futures charts and a map, silvics
        tables, exports, species outlooks, and documentation. The reports and BEC futures chart consume results
        generated from the remote model database.
      </p>
      <p>
        Map overlay: CCISS tile server, numeric GeoTIFF tiles, or polygons generated from that download. Numeric
        results: a prepared GeoTIFF or your local download. Tile trace is a separate colour reconstruction with inferred
        labels, never a numeric calculation source.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <ExternalLink href="https://thebeczone.ca/shiny/cciss/">Open CCISS Spatial</ExternalLink>
        <ExternalLink href="https://bcgov-ffec.ca/cciss-docs/Instructions.html">See the CCISS page guide</ExternalLink>
      </div>
    </CollapsibleSection>
  )
}
