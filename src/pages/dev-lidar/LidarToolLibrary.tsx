import { ArrowUpRight, Layers3 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { InlineAlert } from '@/components/ui/map-panels'
import { ToolPageHeader } from '@/components/ui/tool-page-header'
import { LIDAR_TOOLS, toolPath } from './workspaceTools'

export function LidarToolLibrary({ valid = true }: { valid?: boolean }) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-8" aria-label="LiDAR tool library">
      <div className="mx-auto max-w-5xl">
        <ToolPageHeader
          className="mb-0"
          eyebrow="BC 093G086 · original LiDAR + processed products"
          eyebrowIcon={Layers3}
          eyebrowClassName="text-emerald-700 dark:text-emerald-400"
          title="LiDAR tools"
          description="Explore the completed BC examples, or open Import & data to view your own point clouds and processed layers. Imported data stays in its own workspace; example analyses use the bundled BC tile."
        />
        {!valid && (
          <div role="alert" className="mt-3">
            <InlineAlert tone="warning">That LiDAR tool was not found. Choose a workspace below.</InlineAlert>
          </div>
        )}
        <section
          className="mt-5 rounded-lg border border-emerald-700/30 bg-emerald-500/5 p-4"
          aria-label="Completed LiDAR examples"
        >
          <h2 className="font-semibold">Start with a completed example</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open the processed BC canopy and tree results immediately, or inspect BC VRI timber volume with LiDAR
            context. No upload or setup required to view these results.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(
              [
                [toolPath('inventory'), 'Tree inventory & polygon summaries'],
                [toolPath('canopy'), 'BC canopy map'],
                [toolPath('compare'), 'Tree model results & 3D'],
                [toolPath('volume'), 'BC inventory volume & harvest scenarios'],
                ['/dev/lidar/restoration', 'Local LiDAR road restoration'],
              ] as const
            ).map(([to, label]) => (
              <Link
                key={to}
                to={to}
                className="inline-flex items-center gap-1 rounded-md border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted touch:min-h-10"
              >
                {label}
                <ArrowUpRight className="size-3" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </section>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LIDAR_TOOLS.map((tool) => (
            <Link
              key={tool.id}
              to={toolPath(tool.id)}
              className="group flex flex-col rounded-lg border bg-card p-5 transition-all duration-200 hover:border-primary/50 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{tool.title}</h2>
                <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" />
              </div>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{tool.description}</p>
              <p className="mt-4 text-xs font-medium text-emerald-800 dark:text-emerald-300">{tool.outputs}</p>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          84.6 million source returns · candidate-based analyses · source methods and limitations are available inside
          each workspace.
        </p>
      </div>
    </main>
  )
}
