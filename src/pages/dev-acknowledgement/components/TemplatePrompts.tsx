import { FileText } from 'lucide-react'

import { CollapsiblePanel } from './CollapsiblePanel'
import { acknowledgementTemplatePrompts } from '../data'

export function TemplatePrompts() {
  return (
    <CollapsiblePanel title="Template Prompts" icon={<FileText className="h-4 w-4 text-teal-700" />} defaultOpen={false}>
      <div className="space-y-2 text-xs leading-5 text-slate-600">
        {acknowledgementTemplatePrompts.map((item) => (
          <div key={item.label} className="rounded-md border p-3">
            <div className="font-semibold text-slate-900">{item.label}</div>
            <p className="mt-1">{item.prompt}</p>
          </div>
        ))}
      </div>
    </CollapsiblePanel>
  )
}
