import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, BookOpen, Database, Landmark, MapPinned } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ui/copy-button'
import { ExternalLink } from '@/components/ui/text-button'
import {
  AIR_DATA_VIEWS,
  AIR_MAPS,
  AIR_RESEARCH_GUIDE,
  AIR_SOURCE_REPOSITORY,
  AIR_STREAMS,
  airSourcePage,
  proposedAirStreamConfig,
  type AirCatalogEntry,
} from './dev-gov/airMonitoringCatalog'

function AirSourceCard({ entry }: { entry: AirCatalogEntry }) {
  return (
    <article
      id={entry.id}
      aria-labelledby={`${entry.id}-title`}
      className="flex flex-col rounded-lg border bg-card p-5"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone="info">Recreation option</Badge>
        <span className="text-xs text-muted-foreground">{entry.period}</span>
      </div>
      <h3 id={`${entry.id}-title`} className="text-lg font-semibold">
        {entry.title}
      </h3>
      <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{entry.description}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        {entry.originalViewAvailable !== false ? (
          <ExternalLink href={airSourcePage(entry.sourcePath) + (entry.sourceQuery ?? '')}>Original view</ExternalLink>
        ) : (
          <span className="text-xs text-muted-foreground">
            Original widget URL unavailable; source and CSV retained.
          </span>
        )}
        <ExternalLink href={`${AIR_SOURCE_REPOSITORY}/blob/master/${entry.sourcePath}`}>Source code</ExternalLink>
        {entry.wrapperPath ? (
          <ExternalLink href={airSourcePage(entry.wrapperPath)}>Full source page</ExternalLink>
        ) : null}
      </div>
      <details className="mt-4 border-t pt-4">
        <summary className="cursor-pointer rounded text-sm font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4">
          Data stream and recreation plan
        </summary>
        <div className="mt-3 space-y-4 text-sm leading-6">
          <p>{entry.recreation}</p>
          <div>
            <p className="font-medium">Source fields</p>
            <p className="break-words font-mono text-xs text-muted-foreground">{entry.fields.join(', ')}</p>
          </div>
          {entry.streams.map((id) => {
            const stream = AIR_STREAMS[id]
            return (
              <div key={id} className="min-w-0 rounded-md bg-muted/50 p-3">
                <p className="font-medium">{stream.title}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{stream.source}</p>
                {!stream.source.includes('{') ? (
                  <ExternalLink className="mt-2" href={stream.source}>
                    Source CSV
                  </ExternalLink>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">Identity: {stream.identity}</p>
                <p className="mt-2 text-xs font-medium">Proposed product</p>
                <p className="break-all font-mono text-xs text-muted-foreground">{stream.proposedProduct}</p>
              </div>
            )
          })}
          <CopyButton
            text={() => proposedAirStreamConfig(entry)}
            className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            Copy proposed stream config
          </CopyButton>
        </div>
      </details>
    </article>
  )
}

export default function DevGov() {
  useEffect(() => {
    const previous = document.title
    document.title = 'Government map catalog · PGMaps Dev'
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 pb-12 pt-24 sm:px-6 sm:pt-28 md:py-12">
        <Link
          to="/dev"
          className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Dev library
        </Link>
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Landmark className="size-4" aria-hidden="true" />
          Government sources
        </div>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Government map catalog</h1>
        <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
          Explore every map in B.C.’s air-monitoring visualization project, its data streams and an option for
          recreating it in PGMaps. This catalog contains plans and original-source links; native recreations and
          refreshed feeds are proposed.
        </p>

        <section aria-labelledby="integration-title" className="my-8 rounded-lg border bg-card p-5 sm:p-6">
          <h2 id="integration-title" className="flex items-center gap-2 text-xl font-semibold">
            <Database className="size-5" aria-hidden="true" />
            One ingestion pipeline, many map views
          </h2>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-muted-foreground">
            Fetch the original CSVs on a schedule, validate them, and publish shared station and AQHI products. PGMaps
            already reads a bundled station CSV. Its refresh date needs checking before it can represent current
            conditions.
          </p>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-muted-foreground">
            Tests on 2 November 2026 found that direct CSV reads were blocked across origins. The legacy parser allowed
            browser access, but PHP messages broke normal JSON parsing. Diagnostic cleanup recovered matching data; a
            scheduled CSV feed is the preferred integration.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <ExternalLink href={AIR_RESEARCH_GUIDE} variant="button">
              <BookOpen className="size-3.5" aria-hidden="true" />
              Findings and integration guide
            </ExternalLink>
            <Link
              to="/airquality"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Existing air-quality workspace
            </Link>
          </div>
        </section>

        <section aria-labelledby="legacy-maps-title">
          <h2 id="legacy-maps-title" className="flex items-center gap-2 text-2xl font-semibold">
            <MapPinned className="size-5" aria-hidden="true" />
            Legacy maps <Badge>{AIR_MAPS.length}</Badge>
          </h2>
          <p className="mb-5 mt-2 text-sm text-muted-foreground">
            Pollutant and averaging-period views share one station feed. Wrapper pages link to the same underlying maps.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {AIR_MAPS.map((entry) => (
              <AirSourceCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>

        <section aria-labelledby="data-views-title" className="mt-10">
          <h2 id="data-views-title" className="text-2xl font-semibold">
            Graphs, table and widgets <Badge>{AIR_DATA_VIEWS.length}</Badge>
          </h2>
          <p className="mb-5 mt-2 text-sm text-muted-foreground">
            Related views can become reusable history panels, a summary table and AQHI cards.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {AIR_DATA_VIEWS.map((entry) => (
              <AirSourceCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
