import { Link } from 'react-router-dom'
import { CheckCircle2, GraduationCap } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ToolPageHeader } from '@/components/ui/tool-page-header'
import { withBase } from '@/lib/dataUrl'
import { ROAD_LESSON_TOPICS } from '@/pages/dev-forestry-roads/tours/roadLessons'
import { InterfaceChoice, LessonActions } from './LessonActions'
import { helpHref } from './helpLinks'
import { useLessonCompletions, useRoadLessonCatalog, type CatalogLesson } from './useRoadLessonCatalog'
import type { HelpInterfaces } from './Help'

const HILLSIDE_PLAN = {
  src: 'hillside-plan.webp',
  width: 1240,
  height: 580,
  alt: 'Plan of the Hillside access training road climbing northeast across elevation contours.',
}

function Completed({ when }: { when: number }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-success"
      title={`Finished ${new Date(when).toLocaleDateString()}`}
    >
      <CheckCircle2 className="size-3.5" aria-hidden="true" />
      Completed
    </span>
  )
}

/** The lesson to suggest: the first one not finished, else the first. */
function upNext(lessons: readonly CatalogLesson[], finished: Readonly<Record<string, unknown>>) {
  return lessons.find((entry) => !(entry.manifest.id in finished)) ?? lessons[0]
}

export function HelpHome({ interfaces }: { interfaces: HelpInterfaces }) {
  useDocumentTitle('Road design help · PGMaps')
  const { lessons, error } = useRoadLessonCatalog()
  const finished = useLessonCompletions()
  const done = lessons?.filter((entry) => entry.manifest.id in finished).length ?? 0
  const next = lessons && upNext(lessons, finished)
  // A picture that fills the card without cropping it to a strip, else the training hillside.
  const picture =
    (next && Object.values(next.lesson.figures).find((figure) => figure.width / figure.height <= 2.5)) ?? HILLSIDE_PLAN
  return (
    <main className="container mx-auto px-4 py-8 sm:px-6 sm:py-12">
      <ToolPageHeader
        size="lg"
        className="mb-8"
        eyebrow="Road design help"
        eyebrowIcon={GraduationCap}
        eyebrowClassName="text-muted-foreground"
        title="Road design workflows"
        description="Learn the road designer on the Hillside access training project. Practise a lesson with the real controls, watch it run by itself, or read its illustrated guide."
        aside={<InterfaceChoice interfaces={interfaces} />}
      />
      {error && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-sm">
          The lessons could not be loaded: {error}
        </p>
      )}
      {!lessons && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading lessons…
        </p>
      )}
      {lessons && next && (
        <>
          <section
            aria-labelledby="help-next-title"
            className="mb-10 grid overflow-hidden rounded-lg border bg-card md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
          >
            <div className="flex flex-col justify-center gap-3 p-6 sm:p-8">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                {done === 0 ? 'Start here' : done === lessons.length ? 'All lessons completed' : 'Up next'} · Lesson{' '}
                {next.number} of {lessons.length}
              </p>
              <h2 id="help-next-title" className="text-2xl font-semibold text-foreground">
                {next.manifest.title}
              </h2>
              {next.manifest.description && (
                <p className="text-sm leading-6 text-muted-foreground">{next.manifest.description}</p>
              )}
              <LessonActions manifest={next.manifest} interfaceId={interfaces.chosen} guide size="default" />
              <p className="text-xs text-muted-foreground">
                {done} of {lessons.length} lessons completed in this browser.
              </p>
            </div>
            {picture && (
              <img
                src={withBase(`/help/${picture.src}`)}
                width={picture.width}
                height={picture.height}
                alt={picture.alt}
                className="h-full w-full border-t object-cover md:border-l md:border-t-0"
              />
            )}
          </section>
          <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)]">
            <nav aria-labelledby="help-topics" className="lg:sticky lg:top-6 lg:self-start">
              <h2 id="help-topics" className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Topics
              </h2>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:flex-col">
                {ROAD_LESSON_TOPICS.filter((topic) => lessons.some((entry) => entry.lesson.topic === topic.id)).map(
                  (topic) => (
                    <li key={topic.id}>
                      <a href={`#topic-${topic.id}`} className="text-muted-foreground hover:text-foreground">
                        {topic.title}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            </nav>
            <div className="flex flex-col gap-10">
              {ROAD_LESSON_TOPICS.map((topic) => {
                const inTopic = lessons.filter((entry) => entry.lesson.topic === topic.id)
                if (!inTopic.length) return null
                return (
                  <section key={topic.id} id={`topic-${topic.id}`} aria-labelledby={`topic-${topic.id}-title`}>
                    <h2 id={`topic-${topic.id}-title`} className="mb-3 border-b pb-2 text-lg font-semibold">
                      {topic.title}
                    </h2>
                    <ol className="flex flex-col divide-y">
                      {inTopic.map((entry) => (
                        <li
                          key={entry.manifest.id}
                          data-lesson={entry.manifest.id}
                          className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                              <h3 className="font-medium">
                                <Link
                                  to={helpHref(`/help/${entry.manifest.id}`, interfaces.chosen)}
                                  className="hover:underline"
                                >
                                  {entry.manifest.title}
                                </Link>
                              </h3>
                              <span className="text-xs text-muted-foreground">
                                {entry.manifest.estimatedMinutes} min
                              </span>
                              {finished[entry.manifest.id] && (
                                <Completed when={finished[entry.manifest.id].completedAt} />
                              )}
                            </div>
                            {entry.manifest.description && (
                              <p className="mt-1 text-sm text-muted-foreground">{entry.manifest.description}</p>
                            )}
                          </div>
                          <div className="shrink-0">
                            <LessonActions manifest={entry.manifest} interfaceId={interfaces.chosen} guide />
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                )
              })}
            </div>
          </div>
        </>
      )}
    </main>
  )
}
