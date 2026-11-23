import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { FramePages } from '@/components/ui/frame-pages'
import { InfoTip } from '@/components/ui/info-tip'
import { InlineAlert } from '@/components/ui/map-panels'
import { SaveAsButton } from '@/components/ui/save-as-button'
import { downloadText } from '@/lib/download'
import { escapeHtml } from '@/lib/escapeHtml'
import { cn } from '@/lib/utils'
import type { Pack } from '../../../packages/legal-rules/src/contract'
import { BLOCK_PLANNING_EXPORTS, buildExport, type BlockPlanningExport } from './exports'
import type { Plan } from './plan'
import type { PlanAnalysis } from './planAnalysis'

const PREVIEW_CHARS = 30_000

/** A JSON file shown in the shared page viewer, so every preview has the same bar and gestures. */
const textPage = (text: string) =>
  `<!doctype html><meta charset="utf-8"><pre style="font:12px/1.45 ui-monospace,monospace;white-space:pre-wrap;margin:12px">${escapeHtml(
    text.length > PREVIEW_CHARS ? text.slice(0, PREVIEW_CHARS) + '\n…' : text,
  )}</pre>`

/**
 * Save & export: every file the block planner writes, in one place. The preview is the file that
 * downloads, built from the same state; outputs that read the patch run wait for it.
 */
export function SaveExportDialog({
  open,
  onOpenChange,
  plan,
  result,
  running,
  library,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: Plan
  result: PlanAnalysis | undefined
  running: boolean
  library: Pack[]
}) {
  const [chosen, setChosen] = useState<BlockPlanningExport>('plan')
  const output = BLOCK_PLANNING_EXPORTS.find((o) => o.id === chosen)!
  const today = new Date().toISOString().slice(0, 10)
  const waiting = output.needsResult && !result
  let file: string | null = null
  let problem = ''
  if (open && !waiting) {
    try {
      file = buildExport(chosen, plan, result, library, today)
    } catch (e) {
      problem = e instanceof Error ? e.message : 'The file could not be built.'
    }
  }
  const build = () => buildExport(chosen, plan, result, library, today)
  return (
    <PanelDialog open={open} onOpenChange={onOpenChange} title="Save & export" size="xl" bodyClassName="p-0">
      <div className="grid min-h-[60vh] gap-3 p-3 md:grid-cols-[15rem_1fr]" data-testid="block-planning-export">
        <ul className="space-y-1" aria-label="Outputs">
          {BLOCK_PLANNING_EXPORTS.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                aria-pressed={o.id === chosen}
                onClick={() => setChosen(o.id)}
                className={cn(
                  'w-full rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent',
                  o.id === chosen && 'border-primary bg-accent font-medium',
                )}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
        <section className="flex min-h-0 min-w-0 flex-col gap-2" aria-label={output.label}>
          <div className="flex items-center gap-1">
            <h3 className="text-sm font-semibold">{output.label}</h3>
            <InfoTip label={`About ${output.label}`}>{output.description}</InfoTip>
          </div>
          {waiting ? (
            <InlineAlert tone="info" loading={running}>
              {running
                ? 'Waiting for the patch calculation to finish.'
                : 'This file reads the patch calculation: set the reporting unit in step 1.'}
            </InlineAlert>
          ) : problem ? (
            <InlineAlert tone="error">{problem}</InlineAlert>
          ) : (
            file !== null && (
              <FramePages
                className="min-h-[50vh] flex-1"
                title={output.label}
                html={chosen === 'summary' ? file : textPage(file)}
                resetKey={chosen}
              />
            )
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={file === null}
              onClick={() => file !== null && downloadText(file, output.fileName, output.type.mime)}
            >
              <Download className="size-4" />
              Download
            </Button>
            <SaveAsButton
              variant="outline"
              disabled={file === null}
              suggestedName={output.fileName}
              fileType={output.type}
              content={build}
              rememberFolderAs="block-planning"
            />
          </div>
        </section>
      </div>
    </PanelDialog>
  )
}
