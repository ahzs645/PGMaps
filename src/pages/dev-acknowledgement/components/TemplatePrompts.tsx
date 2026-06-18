import { FileText } from 'lucide-react'

import { acknowledgementTemplatePrompts } from '../data'

export function TemplatePrompts() {
  return (
    <section className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4 text-teal-700" />
        <h2 className="text-sm font-semibold">Template Prompts</h2>
      </div>
      <div className="space-y-2 text-xs leading-5 text-slate-600">
        {acknowledgementTemplatePrompts.map((item) => (
          <div key={item.label} className="rounded-md border p-3">
            <div className="font-semibold text-slate-900">{item.label}</div>
            <p className="mt-1">{item.prompt}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
