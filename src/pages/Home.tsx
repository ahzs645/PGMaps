import { Link } from 'react-router-dom'
import {
  UtensilsCrossed,
  Wind,
  Trees,
  BarChart3,
  Calendar,
  Layers,
  ArrowRight
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

  return (
    <Link
      to={isAvailable ? href : '#'}
      className={cn(
        "group relative flex flex-col p-6 rounded-xl border bg-card transition-all duration-200",
        isAvailable
          ? "hover:shadow-lg hover:border-primary/50 cursor-pointer"
          : "opacity-60 cursor-not-allowed"
      )}
    >
      <div className={cn(
        "flex h-12 w-12 items-center justify-center rounded-lg mb-4",
        color
      )}>
        <Icon className="h-6 w-6 text-white" />
      </div>

      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground flex-1">{description}</p>

      {isAvailable ? (
        <div className="flex items-center gap-1 mt-4 text-sm font-medium text-primary group-hover:gap-2 transition-all">
          Open map
          <ArrowRight className="h-4 w-4" />
        </div>
      ) : (
        <div className="mt-4 text-sm font-medium text-muted-foreground">
          Coming soon
        </div>
      )}
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
    status: 'coming-soon',
  },
  {
    title: 'Parks & Trails',
    description: 'Discover parks, trails, and recreational areas. Find amenities, trail difficulty, and accessibility info.',
    icon: Trees,
    href: '/parks',
    color: 'bg-green-500',
    status: 'coming-soon',
  },
  {
    title: 'Socioeconomic Data',
    description: 'Visualize census data, income levels, demographics, and other socioeconomic indicators by neighborhood.',
    icon: BarChart3,
    href: '/socioeconomic',
    color: 'bg-purple-500',
    status: 'coming-soon',
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
    description: 'Combine multiple data layers to create custom map views. Toggle layers, adjust opacity, and discover patterns.',
    icon: Layers,
    href: '/explorer',
    color: 'bg-indigo-500',
    status: 'coming-soon',
  },
]

export default function Home() {
  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Prince George Data Platform
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Explore and analyze multiple datasets about Prince George through interactive maps.
            Combine layers, build custom scores, and discover insights about your community.
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex justify-center gap-4 mb-12">
          <Button asChild size="lg">
            <Link to="/explorer">
              <Layers className="h-5 w-5 mr-2" />
              Open Explorer
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/score-builder">
              <BarChart3 className="h-5 w-5 mr-2" />
              Build Custom Score
            </Link>
          </Button>
        </div>

        {/* Map Cards Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {mapProjects.map((project) => (
            <MapCard key={project.href} {...project} />
          ))}
        </div>

        {/* Footer Info */}
        <div className="mt-16 text-center">
          <p className="text-sm text-muted-foreground">
            Data sources include Northern Health, City of Prince George, BC Data Catalogue, and more.
          </p>
        </div>
      </div>
    </div>
  )
}
