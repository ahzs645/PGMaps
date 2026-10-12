import { Link } from 'react-router-dom'
import { Activity, ArrowRight, Calculator, Flame, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SCORE_LABS, type ScoreLabKind } from '@/maps/scorebuilder/lib/labs'

const LAB_CARDS: Record<ScoreLabKind, { icon: LucideIcon; color: string; detail: string }> = {
  index: {
    icon: Calculator,
    color: 'bg-cyan-600',
    detail: 'Weigh several metrics into one score, rank regions, and export the results.',
  },
  density: {
    icon: Flame,
    color: 'bg-amber-500',
    detail: 'Pick a single metric and see where it is highest and lowest.',
  },
  correlate: {
    icon: Activity,
    color: 'bg-indigo-500',
    detail: 'Pick two metrics and see how strongly they move together, region by region.',
  },
}

/**
 * The Labs landing page. Each lab is a separate page that shows only its own concept;
 * this page is the one place they are listed side by side.
 */
export default function Labs() {
  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 pb-8 pt-20 sm:px-6 sm:pb-12 sm:pt-28 md:py-12">
        <div className="mb-6 text-center sm:mb-10">
          <h1 className="mb-3 text-3xl font-bold tracking-tight sm:text-5xl">Labs</h1>
          <p className="mx-auto max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-lg">
            Three ways to analyze Prince George regions. Each lab focuses on one question; come back here to switch.
          </p>
        </div>

        <div className="grid gap-4 sm:gap-5 md:grid-cols-3" data-labs-grid="true">
          {SCORE_LABS.map((lab) => {
            const { icon: Icon, color, detail } = LAB_CARDS[lab.kind]
            return (
              <Link
                key={lab.kind}
                to={lab.path}
                data-lab-card={lab.kind}
                className="group flex h-full flex-col rounded-lg border bg-card p-4 transition-all duration-200 hover:border-primary/50 hover:shadow-lg sm:rounded-xl sm:p-6"
              >
                <div
                  className={cn(
                    'mb-3 flex h-10 w-10 items-center justify-center rounded-lg sm:mb-4 sm:h-12 sm:w-12',
                    color,
                  )}
                >
                  <Icon className="h-4 w-4 text-white sm:h-6 sm:w-6" />
                </div>
                <h2 className="mb-2 text-lg font-semibold text-foreground sm:text-xl">{lab.title}</h2>
                <p className="text-sm leading-6 text-muted-foreground sm:text-base">{lab.description}</p>
                <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{detail}</p>
                <div className="mt-3 flex items-center gap-1 text-sm font-medium text-primary transition-all group-hover:gap-2 sm:mt-5">
                  Open {lab.title}
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
