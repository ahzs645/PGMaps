import { Link } from 'react-router-dom'
import {
  UtensilsCrossed,
  Wind,
  BarChart3,
  Calculator,
  Calendar,
  Layers,
  ShieldAlert,
  ArrowRight,
  Database,
  Trees,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface MapCardProps {
  title: string
  description: string
  icon: React.ElementType
  href: string
  color: string
  status: 'available' | 'coming-soon'
}

function MapCard({ title, description, icon: Icon, href, color, status }: MapCardProps) {
  const isAvailable = status === 'available'
  const firstSentenceEnd = description.indexOf('.')
  const compactDescription = firstSentenceEnd > -1
    ? description.slice(0, firstSentenceEnd + 1)
    : description
  const cardClasses = cn(
    'group relative flex h-full flex-col rounded-lg border bg-card p-4 transition-all duration-200 sm:rounded-xl sm:p-6',
    isAvailable
      ? 'hover:border-primary/50 hover:shadow-lg cursor-pointer'
      : 'opacity-60'
  )

  const cardContent = (
    <>
      <div className={cn(
        'mb-3 flex h-10 w-10 items-center justify-center rounded-lg sm:mb-4 sm:h-12 sm:w-12',
        color
      )}>
        <Icon className="h-4 w-4 text-white sm:h-6 sm:w-6" />
      </div>

      <h3 className="mb-2 text-lg font-semibold text-foreground sm:text-xl">{title}</h3>
      <p className="flex-1 text-sm leading-6 text-muted-foreground sm:text-base sm:leading-relaxed">
        <span className="sm:hidden">{compactDescription}</span>
        <span className="hidden sm:inline">{description}</span>
      </p>

      {isAvailable ? (
        <div className="mt-3 flex items-center gap-1 text-sm font-medium text-primary transition-all group-hover:gap-2 sm:mt-5">
          Open map
          <ArrowRight className="h-4 w-4" />
        </div>
      ) : (
        <div className="mt-3 text-sm font-medium text-muted-foreground sm:mt-5">
          Coming soon
        </div>
      )}
    </>
  )

  if (!isAvailable) {
    return (
      <div className={cardClasses} aria-disabled>
        {cardContent}
      </div>
    )
  }

  return (
    <Link to={href} className={cardClasses}>
      {cardContent}
    </Link>
  )
}

const mapProjects: MapCardProps[] = [
  {
    title: 'Food Safety',
    description: 'Explore restaurant health inspection results across Prince George. View ratings, violations, and inspection history.',
    icon: UtensilsCrossed,
    href: '/foodmap',
    color: 'bg-orange-500',
    status: 'available',
  },
  {
    title: 'Air Quality',
    description: 'Monitor real-time air quality data from stations throughout the city. Track AQI, PM2.5, and other pollutants.',
    icon: Wind,
    href: '/airquality',
    color: 'bg-sky-500',
    status: 'available',
  },
  {
    title: 'Parks & Trails',
    description: 'Explore Prince George parks, trails, recreation amenities, and nearby outdoor spaces.',
    icon: Trees,
    href: '/pgdata?tab=parks',
    color: 'bg-emerald-600',
    status: 'available',
  },
  {
    title: 'Census Data',
    description: 'Explore dissemination-area census patterns in Prince George with a choropleth map and sortable neighborhood metrics.',
    icon: BarChart3,
    href: '/census',
    color: 'bg-amber-600',
    status: 'available',
  },
  {
    title: 'Index Lab',
    description: 'Build transparent civic and environmental-health indices with adjustable weights, methods, and explainable region scores.',
    icon: Calculator,
    href: '/score-builder',
    color: 'bg-cyan-600',
    status: 'available',
  },
  {
    title: 'PG Data',
    description: 'Explore City of Prince George open datasets, including property crime, parks, trails, and recreation amenities.',
    icon: ShieldAlert,
    href: '/pgdata',
    color: 'bg-red-500',
    status: 'available',
  },
  {
    title: 'MISC Data',
    description: 'Explore datasets that do not come from the City PG data site, including canopy proxies, heat-shade layers, CANUE, WARS, drinking water, and remote sensing metadata.',
    icon: Database,
    href: '/misc',
    color: 'bg-violet-600',
    status: 'available',
  },
  {
    title: 'Community Events',
    description: 'Find upcoming events, festivals, and community gatherings happening around Prince George.',
    icon: Calendar,
    href: '/events',
    color: 'bg-pink-500',
    status: 'coming-soon',
  },
  {
    title: 'Explorer',
    description: 'Browse all point, line, and polygon datasets together. Filter by geometry type, toggle sources, and rank features by relevance.',
    icon: Layers,
    href: '/explorer',
    color: 'bg-indigo-500',
    status: 'available',
  },
]

export default function Home() {
  const availableProjects = mapProjects.filter((project) => project.status === 'available')
  const upcomingProjects = mapProjects.filter((project) => project.status === 'coming-soon')

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 pb-8 pt-24 sm:px-6 sm:pb-12 sm:pt-28 md:py-12">
        {/* Hero Section */}
        <div className="mb-8 text-center sm:mb-12">
          <h1 className="mb-4 text-5xl font-bold tracking-tight sm:text-6xl">
            Prince George Data Platform
          </h1>
          <p className="mx-auto max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Explore and analyze multiple datasets about Prince George through interactive maps.
            Combine layers, build custom scores, and discover insights about your community.
          </p>
        </div>

        {/* Quick Actions */}
        <div className="mb-10 flex flex-col justify-center gap-3 sm:mb-12 sm:flex-row sm:gap-4">
          <Button asChild size="lg" className="w-full sm:w-auto">
            <Link to="/explorer">
              <Layers className="h-5 w-5 mr-2" />
              Open Explorer
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
            <Link to="/score-builder">
              <BarChart3 className="h-5 w-5 mr-2" />
              Open Index Lab
            </Link>
          </Button>
        </div>

        {/* Available Maps */}
        <section className="mb-8 sm:mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground sm:mb-4">
            Available Maps
          </h2>
          <div className="grid gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3">
            {availableProjects.map((project) => (
              <MapCard key={project.href} {...project} />
            ))}
          </div>
        </section>

        {/* Coming Soon */}
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground sm:mb-4">
            Coming Soon
          </h2>
          <div className="grid gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-3">
            {upcomingProjects.map((project) => (
            <MapCard key={project.href} {...project} />
            ))}
          </div>
        </section>

        {/* Footer Info */}
        <div className="mt-12 text-center sm:mt-16">
          <p className="text-sm text-muted-foreground">
            Data sources include Northern Health, City of Prince George, BC Data Catalogue, and more.
          </p>
        </div>
      </div>
    </div>
  )
}
