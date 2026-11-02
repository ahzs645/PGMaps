import {
  Beaker,
  CircleDollarSign,
  CircleDot,
  Clock3,
  Compass,
  Handshake,
  Loader2,
  MapPinned,
  MousePointerClick,
  Palette,
  RadioTower,
  ShieldAlert,
  Table2,
  TreePine,
  Wind,
  Globe2,
} from 'lucide-react'

import { DevCard, type DevEntry } from '@/components/dev/DevCard'

const AQMAP_SAMPLE_PATH = '/dev/aqmap?lng=-96.0000&lat=56.0000&z=3.10#/3.10/56.0000/-96.0000/B1/L1/L2'

const devEntries: DevEntry[] = [
  {
    title: 'Mission workbench',
    description:
      'MMGIS-inspired Earth GIS: layers, imports, editing, linked plan and globe views, terrain, time and portable local missions.',
    href: '/dev/mmgis',
    icon: Globe2,
    color: 'bg-teal-700',
    label: '/dev/mmgis',
  },
  {
    title: 'LiDAR explorer',
    description:
      'Native LiDAR workbench with terrain, canopy-height proxy, crown and roof candidates, actual GeoLibre algorithm runs and full-cloud streaming.',
    href: '/dev/lidar',
    icon: MapPinned,
    color: 'bg-cyan-700',
    label: '/dev/lidar',
  },
  {
    title: 'Viewshed',
    description:
      'Drag an observer across 3D terrain, compare seated and standing visibility, check the sun against ridges, or import a local DEM.',
    href: '/dev/viewshed',
    icon: MapPinned,
    color: 'bg-rose-600',
    label: '/dev/viewshed',
    subpages: [{ label: 'Local DEM tools', href: '/dev/viewshed/terrain' }],
  },
  {
    title: 'Nechako portal',
    description:
      'Bundled research data, maps and timelines, portal services and search, GIS imports, monitoring and a full capability comparison.',
    href: '/dev/nechako',
    icon: MapPinned,
    color: 'bg-teal-700',
    label: '/dev/nechako',
    subpages: [
      { label: 'Portal interface', href: '/dev/nechako/portal' },
      { label: 'Showcase', href: '/dev/nechako?view=showcase' },
      { label: 'Research map', href: '/dev/nechako?view=research-map' },
      { label: 'Comparison', href: '/dev/nechako?view=compare' },
    ],
  },
  {
    title: 'Water temperature',
    description:
      'UNBC station comparison with linked temperature, seasonality and air/water plots from the reference repository snapshot.',
    href: '/dev/water-temperature',
    icon: CircleDot,
    color: 'bg-sky-600',
    label: '/dev/water-temperature',
  },
  {
    title: 'Flatten',
    description:
      'Walking and cycling routes in Prince George and San Francisco, with live dragging, shortest-to-flattest trade-offs, loops, elevation profiles and GPX export.',
    href: '/dev/flatten/pg',
    icon: MapPinned,
    color: 'bg-emerald-600',
    label: '/dev/flatten',
    subpages: [
      { label: 'Prince George', href: '/dev/flatten/pg' },
      { label: 'San Francisco', href: '/dev/flatten' },
    ],
  },
  {
    title: 'Colour palettes',
    description: 'Palette inventory, page usage, light/dark previews and dynamic colour ranges and class breaks.',
    href: '/dev/color-palettes',
    icon: Palette,
    color: 'bg-violet-600',
    label: '/dev/color-palettes',
  },
  {
    title: 'Climate vulnerability',
    description:
      'MHCCA input explorer, 80-variable source audit, and index reproducibility checks using shared FSA boundaries.',
    href: '/dev/climate-vulnerability',
    icon: MapPinned,
    color: 'bg-teal-700',
    label: '/dev/climate-vulnerability',
  },
  ...(import.meta.env.DEV
    ? [
        {
          title: 'Early development',
          description: 'Local EDI review: historical and current results, source releases, and boundary editions.',
          href: '/dev/early-learning',
          icon: MapPinned,
          color: 'bg-emerald-600',
          label: '/dev/early-learning',
        },
      ]
    : []),
  {
    title: 'AQMap',
    description: 'Air-quality map prototype with URL state, overlays, smoke layers, and AQMap-style controls.',
    href: AQMAP_SAMPLE_PATH,
    icon: Wind,
    color: 'bg-sky-500',
    label: '/dev/aqmap',
    subpages: [{ label: 'Main variant', href: '/dev/aqmap/main' }],
  },
  {
    title: 'Boundaries',
    description:
      'Study-area comparison page for community, school, health, regional, census, watershed, and NR boundaries.',
    href: '/dev/boundaries',
    icon: MapPinned,
    color: 'bg-teal-600',
    label: '/dev/boundaries',
    subpages: [{ label: 'BCER raw vs optimized', href: '/dev/boundaries/bcer' }],
  },
  {
    title: 'Design Lab',
    description: 'Local vector-tile design preview for map style, marker, layer, and theme experiments.',
    href: '/dev/design',
    icon: Palette,
    color: 'bg-violet-600',
    label: '/dev/design',
  },
  {
    title: 'Loading Screen',
    description: 'Interactive preview for map loading animations, labels, visibility, and timing.',
    href: '/dev/load',
    icon: Loader2,
    color: 'bg-sky-600',
    label: '/dev/load',
  },
  {
    title: 'Data Table',
    description:
      'Felt-style bottom data table — resizable pane, All/Visible filter, and a virtualized grid over City of PG layers.',
    href: '/dev/data',
    icon: Table2,
    color: 'bg-amber-600',
    label: '/dev/data',
  },
  {
    title: 'Interaction Lab',
    description:
      'Map interaction prototype for search, measuring, layer visibility, feature popups, and selection flows.',
    href: '/dev/interact',
    icon: MousePointerClick,
    color: 'bg-emerald-600',
    label: '/dev/interact',
  },
  {
    title: 'Sewage Sites',
    description: 'Felt-style proportional-circle point layer (PFAS / sewage spill) with a graduated-circle legend.',
    href: '/dev/interact/sewage',
    icon: CircleDot,
    color: 'bg-pink-600',
    label: '/dev/interact/sewage',
  },
  {
    title: 'ER Wait Times',
    description: 'ERStat-style emergency wait-time labels with live, predicted, no-data, and closed marker states.',
    href: '/dev/health/wait',
    icon: Clock3,
    color: 'bg-red-600',
    label: '/dev/health/wait',
    subpages: [{ label: 'Specialist', href: '/dev/health/wait/specialist' }],
  },
  {
    title: 'MSP Facility Payments',
    description: 'BC MSP Blue Book payees joined to hospital, clinic, and lab provider locations across BC.',
    href: '/dev/health/msp',
    icon: CircleDollarSign,
    color: 'bg-rose-600',
    label: '/dev/health/msp',
  },
  {
    title: 'Transit Travel Times',
    description:
      'Prince George travel-time colours and contours from a movable starting point, with scheduled bus journeys, walking comparison, address search and shareable views.',
    href: '/dev/transit',
    icon: Clock3,
    color: 'bg-emerald-700',
    label: '/dev/transit',
  },
  {
    title: 'Network Coverage',
    description: 'deck.gl comparison map for local TELUS MVT snapshots and Bell polygonized PNG coverage layers.',
    href: '/dev/networks',
    icon: RadioTower,
    color: 'bg-blue-600',
    label: '/dev/networks',
  },
  {
    title: 'Outdoors Planner',
    description:
      'Hunting/fishing trip planner over the WMU PMTiles layer — waypoints, routes, and closure/hunt areas save as JSON, share as a link, and export/import as files, with a real MU 7-42 sample plan.',
    href: '/dev/outdoors',
    icon: Compass,
    color: 'bg-green-700',
    label: '/dev/outdoors',
  },
  {
    title: 'Forestry tools',
    description:
      'Visual quality viewsheds, AVAST block volume with LiDAR and VRI options, CCISS suitability and the LiDAR forestry views, gathered on one page.',
    href: '/dev/forestry',
    icon: TreePine,
    color: 'bg-emerald-700',
    label: '/dev/forestry',
    subpages: [
      { label: 'Visual quality', href: '/dev/forestry/visual-quality' },
      { label: 'AVAST volume', href: '/dev/forestry/avast-volume' },
      { label: 'CCISS suitability', href: '/dev/forestry/cciss-suitability' },
      { label: 'LiDAR forestry', href: '/dev/lidar/forestry/' },
    ],
  },
  {
    title: 'Fallout Sites',
    description:
      'Canadian fallout reporting posts, nuclear shelter references, and communication lines imported from KML.',
    href: '/dev/fallout',
    icon: ShieldAlert,
    color: 'bg-red-700',
    label: '/dev/fallout',
  },
  {
    title: 'Acknowledgement Builder',
    description:
      'Multi-source acknowledgement prototype for comparing territory, consultation, treaty, and verified wording sources.',
    href: '/dev/acknowledgement',
    icon: Handshake,
    color: 'bg-teal-700',
    label: '/dev/acknowledgement',
  },
]

export default function DevLibrary() {
  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 pb-8 pt-24 sm:px-6 sm:pb-12 sm:pt-28 md:py-12">
        <div className="mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1 text-sm font-medium text-muted-foreground">
              <Beaker className="h-4 w-4" />
              Dev library
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Development Pages</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
              Choose a development tool or prototype to open its dedicated subpage.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {devEntries.map((entry) => (
            <DevCard key={entry.href} {...entry} />
          ))}
        </div>
      </div>
    </div>
  )
}
