import { Link } from 'react-router-dom'
import { ArrowRight, Beaker, Droplets, Palette, Wind } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type DevEntry = {
  title: string
  description: string
  href: string
  icon: React.ElementType
  color: string
  label: string
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
    title: 'Design Lab',
    description: 'Local vector-tile design preview for map style, marker, layer, and theme experiments.',
    href: '/dev/design',
    icon: Palette,
    color: 'bg-violet-600',
    label: '/dev/design',
  },
]

function DevCard({ title, description, href, icon: Icon, color, label }: DevEntry) {
  return (
    <Link
      to={href}
      className="group flex h-full flex-col rounded-lg border bg-card p-5 transition-all duration-200 hover:border-primary/50 hover:shadow-lg sm:p-6"
    >
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
    </Link>
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
