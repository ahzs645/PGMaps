import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Play, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DEFAULT_MAP_LOADER,
  MapLoader,
  type MapLoaderVariant,
} from '@/components/ui/map-loader'
import { cn } from '@/lib/utils'

const VARIANTS: Array<{ value: MapLoaderVariant; label: string; description: string }> = [
  { value: 'globe', label: 'ASCII globe', description: 'Canvas-rendered rotating globe' },
  { value: 'spinner', label: 'Spinner', description: 'Concentric animated rings' },
]

export default function DevLoad() {
  const [variant, setVariant] = useState<MapLoaderVariant>(DEFAULT_MAP_LOADER)
  const [label, setLabel] = useState('Loading map data')
  const [isLoading, setIsLoading] = useState(true)
  const [duration, setDuration] = useState(3000)
  const [previewKey, setPreviewKey] = useState(0)
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  const clearReplayTimer = () => {
    if (timeoutRef.current === null) return
    window.clearTimeout(timeoutRef.current)
    timeoutRef.current = null
  }

  const replay = () => {
    clearReplayTimer()
    setPreviewKey((key) => key + 1)
    setIsLoading(true)
    timeoutRef.current = window.setTimeout(() => {
      setIsLoading(false)
      timeoutRef.current = null
    }, duration)
  }

  const toggleLoading = () => {
    clearReplayTimer()
    setPreviewKey((key) => key + 1)
    setIsLoading((loading) => !loading)
  }

  const reset = () => {
    clearReplayTimer()
    setVariant(DEFAULT_MAP_LOADER)
    setLabel('Loading map data')
    setDuration(3000)
    setPreviewKey((key) => key + 1)
    setIsLoading(true)
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/30">
      <div className="container mx-auto px-4 pb-10 pt-24 sm:px-6 sm:pt-28 md:py-12">
        <div className="mb-8 flex flex-col gap-3">
          <div className="text-sm font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
            Dev playground
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Map loading screen</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Preview the production map loader without waiting for a map or dataset to load.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">Preview</h2>
                <p className="text-xs text-muted-foreground">The overlay below is the real MapLoader component.</p>
              </div>
              <span
                className={cn(
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  isLoading
                    ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {isLoading ? 'Loading' : 'Loaded'}
              </span>
            </div>

            <div className="relative h-[30rem] overflow-hidden bg-[#dce8d8] dark:bg-[#17251f] sm:h-[36rem]">
              <div
                className="absolute inset-0 opacity-70 dark:opacity-35"
                style={{
                  backgroundImage:
                    'linear-gradient(28deg, transparent 47%, rgba(255,255,255,.85) 48%, rgba(255,255,255,.85) 51%, transparent 52%), linear-gradient(104deg, transparent 44%, rgba(255,255,255,.65) 45%, rgba(255,255,255,.65) 48%, transparent 49%), radial-gradient(circle at 25% 28%, rgba(116,170,112,.55) 0 12%, transparent 13%), radial-gradient(circle at 78% 72%, rgba(116,170,112,.45) 0 17%, transparent 18%)',
                }}
              />
              <div className="absolute -bottom-16 left-[44%] h-[130%] w-24 rotate-[18deg] rounded-[50%] bg-sky-300/70 shadow-[0_0_0_2px_rgba(255,255,255,.45)] dark:bg-sky-900/70" />
              <div className="absolute left-[18%] top-[24%] h-4 w-4 rounded-full border-4 border-white bg-rose-500 shadow-md" />
              <div className="absolute bottom-[22%] right-[20%] h-4 w-4 rounded-full border-4 border-white bg-amber-500 shadow-md" />
              <div className="absolute bottom-4 left-4 rounded-md border bg-background/85 px-3 py-2 text-xs text-muted-foreground shadow-sm backdrop-blur">
                Mock map canvas
              </div>
              <MapLoader
                key={previewKey}
                visible={isLoading}
                label={label || 'Loading map data'}
                variant={variant}
              />
            </div>
          </section>

          <aside className="h-fit rounded-xl border bg-card p-5 shadow-sm">
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-semibold">Loader style</label>
                <div className="grid gap-2">
                  {VARIANTS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setVariant(option.value)
                        setPreviewKey((key) => key + 1)
                        setIsLoading(true)
                      }}
                      className={cn(
                        'rounded-lg border p-3 text-left transition-colors',
                        variant === option.value
                          ? 'border-sky-500 bg-sky-500/10'
                          : 'bg-background hover:bg-muted/60',
                      )}
                    >
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">{option.description}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="loader-label" className="mb-2 block text-sm font-semibold">
                  Status label
                </label>
                <input
                  id="loader-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Loading map data"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="loader-duration" className="text-sm font-semibold">
                    Replay duration
                  </label>
                  <span className="text-xs tabular-nums text-muted-foreground">{(duration / 1000).toFixed(1)}s</span>
                </div>
                <input
                  id="loader-duration"
                  type="range"
                  min="500"
                  max="10000"
                  step="500"
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  className="w-full accent-sky-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button onClick={replay}>
                  <Play />
                  Replay
                </Button>
                <Button variant="outline" onClick={toggleLoading}>
                  {isLoading ? <EyeOff /> : <Eye />}
                  {isLoading ? 'Hide' : 'Show'}
                </Button>
              </div>

              <Button variant="ghost" className="w-full" onClick={reset}>
                <RotateCcw />
                Reset controls
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
