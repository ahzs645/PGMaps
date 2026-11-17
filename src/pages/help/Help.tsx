import { useEffect, useState } from 'react'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { BrandScope } from '@/branding/BrandScope'
import { AccessLockup } from '@/components/interfaces/AccessLockup'
import { readStoredInterface } from '@/components/interfaces/interfacePreference'
import { loadWorkspaceLayouts, type WorkspaceLayout } from '@/components/interfaces/workspaceLayouts'
import { Button } from '@/components/ui/button'
import { ROAD_LESSON_IDS } from '@/pages/dev-forestry-roads/tours/roadLessons'
import { HelpHome } from './HelpHome'
import { HelpLesson } from './HelpLesson'
import { ROAD_DESIGNER_PATH, helpHref, helpInterface, legacyHelpTarget } from './helpLinks'

/** The interfaces a lesson can open in, and the one the help's links use. */
export interface HelpInterfaces {
  layouts: readonly WorkspaceLayout[]
  chosen: string | null
  choose: (id: string) => void
}

function useHelpInterfaces(): HelpInterfaces {
  const [layouts, setLayouts] = useState<readonly WorkspaceLayout[]>([])
  const [search, setSearch] = useSearchParams()
  useEffect(() => {
    const controller = new AbortController()
    void loadWorkspaceLayouts(controller.signal).then(({ layouts }) => {
      if (!controller.signal.aborted) setLayouts(layouts)
    })
    return () => controller.abort()
  }, [])
  const ids = layouts.map((layout) => layout.id)
  const chosen =
    helpInterface(search.toString(), ids) ?? helpInterface(`?interface=${readStoredInterface() ?? ''}`, ids)
  return {
    layouts,
    chosen,
    choose: (id) => setSearch(new URLSearchParams({ interface: id }), { replace: true }),
  }
}

/**
 * The road designer's help (`/help`, `/help/<lesson>`): illustrated guides written from the same
 * Tourkit manifests that run live in the designer (`docs/forestry-road-design/live-lessons.md`).
 * Addresses of the old static help redirect here.
 */
export default function Help() {
  const rest = useParams()['*'] ?? ''
  const location = useLocation()
  const interfaces = useHelpInterfaces()
  const legacy = legacyHelpTarget(rest, location.search, ROAD_LESSON_IDS)
  if (legacy) return <Navigate to={legacy} replace />
  const lessonId = rest.replace(/\/+$/, '')
  return (
    <BrandScope surface="help">
      <link rel="stylesheet" href={`${import.meta.env.BASE_URL}brand/access.css`} />
      <div className="min-h-full bg-background pt-[calc(env(safe-area-inset-top)+var(--app-navbar-offset,4rem))] md:pt-0">
        <header className="border-b bg-card">
          <div className="container mx-auto flex min-w-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <Link
              to={helpHref('/help', interfaces.chosen)}
              className="flex items-center gap-3 text-foreground"
              aria-label="Road design help"
            >
              <AccessLockup surface="help" />
              <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Help</span>
            </Link>
            <Button asChild variant="outline" size="sm">
              <a
                href={`${import.meta.env.BASE_URL}${ROAD_DESIGNER_PATH.slice(1)}${
                  interfaces.chosen ? `?interface=${interfaces.chosen}` : ''
                }`}
              >
                <span className="sr-only sm:not-sr-only">Open the road designer</span>
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </Button>
          </div>
        </header>
        {lessonId ? <HelpLesson id={lessonId} interfaces={interfaces} /> : <HelpHome interfaces={interfaces} />}
      </div>
    </BrandScope>
  )
}
