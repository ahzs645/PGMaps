import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, CheckCircle2, Download, GraduationCap } from 'lucide-react'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { ToolPageHeader } from '@/components/ui/tool-page-header'
import { withBase } from '@/lib/dataUrl'
import { ROAD_LESSON_TOPICS } from '@/pages/dev-forestry-roads/tours/roadLessons'
import { InterfaceChoice, LessonActions } from './LessonActions'
import { helpHref } from './helpLinks'
import { useLessonCompletions, useRoadLessonCatalog } from './useRoadLessonCatalog'
import type { HelpInterfaces } from './Help'

/**
 * A lesson's illustrated guide. Every step's title and text is the live lesson's own (its Tourkit
 * manifest), so the guide and the lesson cannot say different things; the pictures are the
 * catalog's (`roadLessons.ts`).
 */
export function HelpLesson({ id, interfaces }: { id: string; interfaces: HelpInterfaces }) {
  const { lessons, error } = useRoadLessonCatalog()
  const finished = useLessonCompletions()
  const index = lessons?.findIndex((entry) => entry.manifest.id === id) ?? -1
  const entry = lessons?.[index]
  useDocumentTitle(`${entry?.manifest.title ?? 'Lesson'} · Road design help · PGMaps`)
  const back = (
    <Link
      to={helpHref('/help', interfaces.chosen)}
      className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      All lessons
    </Link>
  )
  if (error || (lessons && !entry))
    return (
      <main className="container mx-auto px-4 py-8 sm:px-6 sm:py-12">
        {back}
        <p role="alert" className="text-sm">
          {error ? `The lesson could not be loaded: ${error}` : 'There is no lesson at this address.'}
        </p>
      </main>
    )
  if (!lessons || !entry)
    return (
      <main className="container mx-auto px-4 py-8 sm:px-6 sm:py-12">
        <p role="status" className="text-sm text-muted-foreground">
          Loading the lesson…
        </p>
      </main>
    )
  const { manifest, lesson } = entry
  const topic = ROAD_LESSON_TOPICS.find((item) => item.id === lesson.topic)
  const previous = lessons[index - 1]
  const next = lessons[index + 1]
  // Steps are numbered through the whole lesson, across its chapters.
  const firstNumber = manifest.chapters.map((_, index) =>
    manifest.chapters.slice(0, index).reduce((count, chapter) => count + chapter.steps.length, 1),
  )
  return (
    <main className="container mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <ToolPageHeader
        size="lg"
        className="mb-6"
        back={back}
        eyebrow={`${topic?.title ?? 'Lesson'} · Lesson ${entry.number} of ${lessons.length}`}
        eyebrowIcon={GraduationCap}
        eyebrowClassName="text-muted-foreground"
        title={manifest.title}
        description={manifest.description}
      />
      <section
        aria-label="Run this lesson"
        className="mb-8 flex flex-col gap-4 rounded-lg border bg-card p-5 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            Run it in the designer: <strong>Practise</strong> with the real controls, or <strong>Watch</strong> it run.
          </p>
          <LessonActions manifest={manifest} interfaceId={interfaces.chosen} size="default" />
          {finished[manifest.id] && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Completed in this browser
            </span>
          )}
        </div>
        <InterfaceChoice interfaces={interfaces} />
      </section>
      {(manifest.setup || lesson.downloads?.length) && (
        <section aria-labelledby="lesson-setup" className="mb-8">
          <h2 id="lesson-setup" className="mb-2 text-lg font-semibold">
            Before you start
          </h2>
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            {manifest.setup && (
              <>
                <dt className="text-muted-foreground">Goal</dt>
                <dd>{manifest.setup.goal}</dd>
                <dt className="text-muted-foreground">Starting screen</dt>
                <dd>{manifest.setup.startingScreen}</dd>
              </>
            )}
            <dt className="text-muted-foreground">Time</dt>
            <dd>About {manifest.estimatedMinutes} minutes</dd>
            {lesson.downloads?.length ? (
              <>
                <dt className="text-muted-foreground">Sample files</dt>
                <dd className="flex flex-wrap gap-3">
                  {lesson.downloads.map((file) => (
                    <a
                      key={file.src}
                      href={withBase(`/help/${file.src}`)}
                      download
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                      {file.label}
                    </a>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
        </section>
      )}
      {manifest.chapters.map((chapter, chapterIndex) => (
        <section key={chapter.id} aria-labelledby={`chapter-${chapter.id}`} className="mb-8">
          <h2 id={`chapter-${chapter.id}`} className="mb-4 border-b pb-2 text-lg font-semibold">
            {chapter.title}
          </h2>
          <ol className="flex flex-col gap-6">
            {chapter.steps.map((step, stepIndex) => {
              const stepNumber = firstNumber[chapterIndex] + stepIndex
              const figure = lesson.figures[step.id]
              return (
                <li
                  key={step.id}
                  data-step={step.id}
                  className={`grid gap-4 ${figure ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]' : ''}`}
                >
                  <div>
                    <h3 className="font-medium">
                      <span className="mr-2 tabular-nums text-muted-foreground">{stepNumber}.</span>
                      {step.overlay.title}
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.overlay.body}</p>
                    {step.check?.description && (
                      <p className="mt-2 text-xs text-muted-foreground">Done when {step.check.description}.</p>
                    )}
                  </div>
                  {figure && (
                    <figure>
                      <img
                        src={withBase(`/help/${figure.src}`)}
                        width={figure.width}
                        height={figure.height}
                        alt={figure.alt}
                        loading="lazy"
                        className="h-auto w-full rounded-md border"
                      />
                      {figure.caption && (
                        <figcaption className="mt-1 text-xs text-muted-foreground">{figure.caption}</figcaption>
                      )}
                    </figure>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      ))}
      {manifest.setup?.limitations.length ? (
        <p className="mb-8 text-xs text-muted-foreground">{manifest.setup.limitations.join(' ')}</p>
      ) : null}
      <nav aria-label="Other lessons" className="flex flex-wrap justify-between gap-4 border-t pt-6 text-sm">
        {previous ? (
          <Link
            to={helpHref(`/help/${previous.manifest.id}`, interfaces.chosen)}
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {previous.manifest.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            to={helpHref(`/help/${next.manifest.id}`, interfaces.chosen)}
            className="inline-flex items-center gap-1.5 font-medium text-foreground hover:underline"
          >
            Next lesson · {next.manifest.title}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        )}
      </nav>
    </main>
  )
}
