import type { TutorialManifest } from 'tourkit/core'
import { Link } from 'react-router-dom'
import { BookOpen, Eye, Hand } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ROAD_LESSON_FIXTURES } from '@/pages/dev-forestry-roads/tours/roadLessonFixtures'
import { helpHref, lessonLaunchHref } from './helpLinks'
import type { HelpInterfaces } from './Help'

/** The designer address for a lesson, under the deploy base. */
export function launchHref(manifest: TutorialManifest, mode: 'practice' | 'watch', interfaceId: string | null) {
  const fixture = ROAD_LESSON_FIXTURES[manifest.launch.fixture]
  return `${import.meta.env.BASE_URL}${lessonLaunchHref(manifest.id, mode, fixture?.params ?? {}, interfaceId).slice(1)}`
}

/**
 * Practise (the learner does each step with the real controls) and Watch (the lesson does them). Both
 * open the designer in a new tab, so the guide stays open beside it.
 */
export function LessonActions({
  manifest,
  interfaceId,
  guide = false,
  size = 'sm',
}: {
  manifest: TutorialManifest
  interfaceId: string | null
  /** Also offer the illustrated guide. */
  guide?: boolean
  size?: 'sm' | 'default'
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild size={size}>
        <a
          href={launchHref(manifest, 'practice', interfaceId)}
          target="_blank"
          rel="noopener"
          aria-label={`Practise: ${manifest.title} (opens the designer in a new tab)`}
        >
          <Hand className="size-4" aria-hidden="true" />
          Practise
        </a>
      </Button>
      <Button asChild size={size} variant="outline">
        <a
          href={launchHref(manifest, 'watch', interfaceId)}
          target="_blank"
          rel="noopener"
          aria-label={`Watch: ${manifest.title} (opens the designer in a new tab)`}
        >
          <Eye className="size-4" aria-hidden="true" />
          Watch
        </a>
      </Button>
      {guide && (
        <Button asChild size={size} variant="ghost">
          <Link to={helpHref(`/help/${manifest.id}`, interfaceId)} aria-label={`Read the guide: ${manifest.title}`}>
            <BookOpen className="size-4" aria-hidden="true" />
            Read the guide
          </Link>
        </Button>
      )}
    </div>
  )
}

/** Which interface the lessons open in; the lesson text names controls, the ring finds them in any. */
export function InterfaceChoice({ interfaces }: { interfaces: HelpInterfaces }) {
  if (!interfaces.layouts.length) return null
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground" id="help-interface-label">
        Lessons open in
      </span>
      <SegmentedControl
        label="Interface the lessons open in"
        value={interfaces.chosen ?? ''}
        options={interfaces.layouts.map((layout) => ({ value: layout.id, label: layout.shortName ?? layout.name }))}
        onChange={interfaces.choose}
        size="sm"
      />
    </div>
  )
}
