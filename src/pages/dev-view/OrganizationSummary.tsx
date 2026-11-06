import { Badge } from '@/components/ui/badge'
import type { CatalogueFacets, Organization } from './catalogue'

export function OrganizationSummary({
  value,
  facets,
  detail = false,
}: {
  value?: Organization
  facets?: CatalogueFacets
  detail?: boolean
}) {
  if (!value) return null
  const labels = new Map(
    [...(facets?.subjects || []), ...(facets?.regions || []), ...(facets?.eras || [])].map((v) => [v.id, v.label]),
  )
  const label = (id: string) => labels.get(id) || id.replace(/[-_]+/g, ' ')
  const subjects = detail ? value.subjects : value.subjects.slice(0, 2)
  return (
    <div className="w-full min-w-0 space-y-1.5 break-words text-xs text-muted-foreground">
      {!!subjects.length && (
        <div className="flex flex-wrap gap-1">
          {subjects.map((subject) => (
            <Badge key={subject} tone="info" className="max-w-full whitespace-normal break-words">
              {label(subject)}
            </Badge>
          ))}
          {!detail && value.subjects.length > 2 && <span>+{value.subjects.length - 2}</span>}
        </div>
      )}
      {value.region && (
        <p>
          {label(value.region)}
          {value.regionConfidence === 'low' ? ' · inferred' : ''}
        </p>
      )}
      {(value.pageLabel || value.variantLabel) && (
        <p>{[value.pageLabel, value.variantLabel].filter(Boolean).join(' · ')}</p>
      )}
      {detail && value.sourceGroupTitle && <p>Source document: {value.sourceGroupTitle}</p>}
      {detail && value.classificationConfidence && <p>Category confidence: {value.classificationConfidence}</p>}
      {detail && value.regionEvidence && (
        <p className="leading-relaxed">
          Region evidence{value.regionConfidence ? ` (${value.regionConfidence})` : ''}: {value.regionEvidence}
        </p>
      )}
      {detail && value.contextDateLabel && <p>{value.contextDateLabel}</p>}
      {detail && value.dateEvidence && (
        <p className="leading-relaxed">
          Date evidence{value.dateKind ? ` (${value.dateKind.replace(/[-_]+/g, ' ')})` : ''}: {value.dateEvidence}
        </p>
      )}
      {detail && value.labelBasis && <p>Label basis: {value.labelBasis}</p>}
      {detail && value.evidence && <p className="leading-relaxed">{value.evidence}</p>}
    </div>
  )
}
