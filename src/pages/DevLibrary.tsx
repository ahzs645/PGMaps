import { Link } from 'react-router-dom'
import type { ElementType } from 'react'
import { ArrowRight, Beaker, CircleDollarSign, CircleDot, Clock3, Droplets, FolderKanban, Handshake, MapPinned, MousePointerClick, Palette, RadioTower, ShieldAlert, Wind } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type DevSubpage = {
  label: string
  href: string
}

type DevEntry = {
  title: string
  description: string
  href: string
  icon: ElementType
  color: string
  label: string
  subpages?: DevSubpage[]
}

const AQMAP_SAMPLE_PATH = '/dev/aqmap?lng=-96.0000&lat=56.0000&z=3.10#/3.10/56.0000/-96.0000/B1/L1/L2'

const devEntries: DevEntry[] = [
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
    title: 'Watersheds',
    description: 'BC watershed development map for testing simplified boundaries and full WFS geometry loading.',
    href: '/dev/watersheds',
    icon: Droplets,
    color: 'bg-cyan-600',
    label: '/dev/watersheds',
  },
  {
    title: 'Boundaries',
    description: 'Study-area comparison page for community, school, health, regional, census, watershed, and NR boundaries.',
    href: '/dev/boundaries',
    icon: MapPinned,
    color: 'bg-teal-600',
    label: '/dev/boundaries',
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
    title: 'Interaction Lab',
    description: 'Map interaction prototype for search, measuring, layer visibility, feature popups, and selection flows.',
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
    href: '/dev/wait',
    icon: Clock3,
    color: 'bg-red-600',
    label: '/dev/wait',
    subpages: [{ label: 'Specialist', href: '/dev/wait/specialist' }],
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
    title: 'Network Coverage',
    description: 'deck.gl comparison map for local TELUS MVT snapshots and Bell polygonized PNG coverage layers.',
    href: '/dev/networks',
    icon: RadioTower,
    color: 'bg-blue-600',
    label: '/dev/networks',
  },
  {
    title: 'Project Mode',
    description: 'Prototype for preset project cards, story scenes, layer/legend/project tabs, and Index Lab handoff.',
    href: '/dev/projects',
    icon: FolderKanban,
    color: 'bg-slate-800',
    label: '/dev/projects',
  },
  {
    title: 'Fallout Sites',
    description: 'Canadian fallout reporting posts, nuclear shelter references, and communication lines imported from KML.',
    href: '/dev/fallout',
    icon: ShieldAlert,
    color: 'bg-red-700',
    label: '/dev/fallout',
  },
  {
    title: 'Acknowledgement Builder',
    description: 'Multi-source acknowledgement prototype for comparing territory, consultation, treaty, and verified wording sources.',
    href: '/dev/acknowledgement',
    icon: Handshake,
    color: 'bg-teal-700',
    label: '/dev/acknowledgement',
  },
]

function DevCard({ title, description, href, icon: Icon, color, label, subpages }: DevEntry) {
  return (
    <div className="group relative flex h-full flex-col rounded-lg border bg-card p-5 transition-all duration-200 hover:border-primary/50 hover:shadow-lg sm:p-6">
      {/* Stretched link makes the whole card open the main page, while the
          subpage buttons below sit on top (relative z-10) as separate links —
          avoids nesting anchors inside an anchor. */}
      <Link to={href} aria-label={`Open ${title}`} className="absolute inset-0 rounded-lg" />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div className={cn('flex h-11 w-11 items-center justify-center rounded-lg', color)}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>

      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{description}</p>

      <div className="mt-5 flex items-center gap-1 text-sm font-medium text-primary transition-all group-hover:gap-2">
        Open dev page
        <ArrowRight className="h-4 w-4" />
      </div>

      {subpages && subpages.length > 0 && (
        <div className="relative z-10 mt-4 border-t pt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Subpages
          </div>
          <div className="flex flex-wrap gap-2">
            {subpages.map((subpage) => (
              <Link
                key={subpage.href}
                to={subpage.href}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
              >
                {subpage.label}
                <ArrowRight className="h-3 w-3" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function DevLibrary() {
  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-8 sm:px-6 sm:py-12">
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

          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link to={AQMAP_SAMPLE_PATH}>
              <Wind className="h-4 w-4" />
              Open AQMap sample
            </Link>
          </Button>
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
