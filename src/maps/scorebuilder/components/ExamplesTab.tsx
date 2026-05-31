import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SCORE_BUILDER_EXAMPLES } from '../constants'
import { getDataSourceLabel } from './scoreBuilderPanelUtils'

interface ExamplesTabProps {
  className?: string
  activeExampleKey: string | null
  onApplyExample: (key: string) => void
  children?: ReactNode
}

export function ExamplesTab({ className, activeExampleKey, onApplyExample, children }: ExamplesTabProps) {
  const selectedExampleKey = activeExampleKey || SCORE_BUILDER_EXAMPLES[0]?.key || null
  const selectedExample = SCORE_BUILDER_EXAMPLES.find((example) => example.key === selectedExampleKey) || null

  return (
    <div className={cn('space-y-3 p-4', className)} data-score-builder-section="examples">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          {['Goal', 'Data', 'Tune', 'Results'].map((step, index) => (
            <div key={step} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                  index === 0
                    ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-200'
                    : 'border-border',
                )}
              >
                {index + 1}
              </span>
              <span>{step}</span>
              {index < 3 && <span className="h-px w-4 bg-border" />}
            </div>
          ))}
        </div>
        {selectedExample && (
          <div className="space-y-2">
            <div>
              <div className="text-sm font-semibold text-foreground">{selectedExample.label}</div>
              <div className="text-xs text-cyan-700 dark:text-cyan-300">{selectedExample.question}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedExample.dataSources.map((ds) => (
                <span
                  key={ds}
                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {getDataSourceLabel(ds)}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onApplyExample(selectedExample.key)}
              className="w-full rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-700"
            >
              Start tuning
            </button>
          </div>
        )}
      </div>

      {[
        { source: 'census' as const, title: 'Census Boundaries (Prince George)' },
        { source: 'bcHealth' as const, title: 'Health Boundaries (CHSA)' },
      ].map(({ source, title }) => {
        const group = SCORE_BUILDER_EXAMPLES.filter((e) => e.boundarySource === source)
        if (!group.length) return null
        return (
          <div key={source}>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </div>
            <div className="space-y-2">
              {group.map((example) => {
                const levelLabel =
                  { ct: 'CT', da: 'DA', chsa: 'CHSA' }[example.boundaryLevel as 'ct' | 'da' | 'chsa'] ||
                  example.boundaryLevel
                return (
                  <button
                    key={example.key}
                    type="button"
                    onClick={() => onApplyExample(example.key)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      selectedExampleKey === example.key
                        ? 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-500/30 dark:bg-cyan-950/40 dark:ring-cyan-400/20'
                        : 'border-border bg-background hover:border-cyan-300 hover:bg-accent dark:hover:border-cyan-800',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-foreground">{example.label}</div>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {levelLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-medium text-cyan-700 dark:text-cyan-300">{example.question}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{example.description}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {example.dataSources.map((ds) => (
                        <span
                          key={ds}
                          className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {getDataSourceLabel(ds)}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      {children}
    </div>
  )
}
