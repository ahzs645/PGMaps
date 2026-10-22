import { ArrowUpRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { LIDAR_TOOLS, toolPath } from './workspaceTools'

export function LidarToolLibrary({ valid = true }: { valid?: boolean }) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-8" aria-label="LiDAR tool library">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-medium uppercase tracking-wider text-emerald-700">
          BC 093G086 · original LiDAR + processed products
        </p>
        <h1 className="mt-2 text-2xl font-semibold">LiDAR tools</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Choose a focused workspace. Switch tools at any time while keeping your map position, basemap and saved
          reviews.
        </p>
        {!valid && (
          <p className="mt-3 text-sm" role="alert">
            That LiDAR tool was not found. Choose a workspace below.
          </p>
        )}
        <section
          className="mt-5 rounded-xl border border-emerald-700/30 bg-emerald-500/5 p-4"
          aria-label="Completed LiDAR examples"
        >
          <h2 className="font-semibold">Start with a completed example</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Open the processed BC canopy and tree results immediately, or inspect BC VRI timber volume with LiDAR
            context. No upload or setup required to view these results.
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium underline">
            <Link to={toolPath('inventory')}>Tree inventory & polygon summaries</Link>
            <Link to={toolPath('canopy')}>BC canopy map</Link>
            <Link to={toolPath('compare')}>Tree model results & 3D</Link>
            <Link to={toolPath('volume')}>BC inventory volume & harvest scenarios</Link>
          </div>
        </section>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LIDAR_TOOLS.map((tool) => (
            <Link
              key={tool.id}
              to={toolPath(tool.id)}
              className="group rounded-xl border bg-card p-5 shadow-sm transition hover:border-emerald-600 hover:bg-emerald-500/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">{tool.title}</h2>
                <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-emerald-700" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{tool.description}</p>
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
