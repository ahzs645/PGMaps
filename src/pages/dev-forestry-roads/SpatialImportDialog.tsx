import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import {
  ROLE_OPTIONS,
  spatialInventory,
  type ImportIntent,
  type ImportRole,
  type RoleChoice,
  type SpatialFile,
  type SpatialShape,
} from './spatialImport'

const SHAPE_NOUNS: Record<SpatialShape, [string, string]> = {
  line: ['line', 'lines'],
  polygon: ['polygon', 'polygons'],
  point: ['point', 'points'],
}
const STATED_NOUNS: Record<ImportRole, [string, string]> = {
  road: ['road', 'roads'],
  'mapped-road': ['existing road', 'existing roads'],
  stream: ['stream', 'streams'],
  'planned-block': ['planned cutblock', 'planned cutblocks'],
  'harvested-block': ['harvested cutblock', 'harvested cutblocks'],
  constraint: ['avoidance area', 'avoidance areas'],
  reference: ['reference feature', 'reference features'],
  skip: ['calculated result', 'calculated results'],
}
const counted = (n: number, [one, many]: [string, string]) => `${n} ${n === 1 ? one : many}`
const listed = (names: string[]) =>
  names.length ? `${names.slice(0, 4).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''}` : 'unnamed'

/**
 * Asks what the features of an imported file are. It opens only when the file does not settle it:
 * nothing is priced, avoided or drawn as a stream until the person has chosen.
 */
export function SpatialImportDialog({
  file,
  intent,
  initial,
  onImport,
  onCancel,
  portalContainer,
}: {
  file: SpatialFile
  /** The picker the file came through: it decides which stated kinds are kept. */
  intent: ImportIntent
  /** The roles offered first; a null shape has no suggestion and must be chosen. */
  initial: RoleChoice
  onImport: (roles: RoleChoice) => void
  onCancel: () => void
  portalContainer?: HTMLElement | null
}) {
  const [roles, setRoles] = useState<RoleChoice>(initial)
  const inventory = useMemo(() => spatialInventory(file, intent), [file, intent])
  const shapes = (['line', 'polygon', 'point'] as const).filter((shape) => inventory.open[shape].length)
  const ready = shapes.every((shape) => roles[shape] !== null)
  const kept = inventory.stated.filter((group) => group.kept)
  const leftOut = inventory.stated.filter((group) => !group.kept)
  const nothing = ready && shapes.every((shape) => roles[shape] === 'skip') && !kept.length
  return (
    <PanelDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={`Import ${file.fileName}`}
      subtitle={`${file.format} · read as ${file.crs}`}
      size="md"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'road-spatial-import' }}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready || nothing} onClick={() => onImport(roles)}>
            Import
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {shapes.map((shape) => {
          const features = inventory.open[shape]
          const names = features.flatMap((f) => (typeof f.properties?.name === 'string' ? [f.properties.name] : []))
          const heading = `${counted(features.length, SHAPE_NOUNS[shape])}: ${listed(names)}`
          return (
            <fieldset key={shape} className="min-w-0 space-y-1.5" data-import-shape={shape}>
              <legend className="text-sm font-medium">{heading}</legend>
              <p className="text-xs text-muted-foreground">Bring {features.length === 1 ? 'it' : 'them'} in as</p>
              {ROLE_OPTIONS[shape].map((option) => (
                <label
                  key={option.role}
                  className="flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                >
                  <input
                    type="radio"
                    className="mt-1"
                    name={`import-${shape}`}
                    value={option.role}
                    checked={roles[shape] === option.role}
                    onChange={() => setRoles({ ...roles, [shape]: option.role })}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">{option.effect}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )
        })}
        {kept.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="road-spatial-import-stated">
            The file says what these are, so they keep it:{' '}
            {kept.map((group) => counted(group.features.length, STATED_NOUNS[group.role])).join(', ')}.
          </p>
        )}
        {leftOut.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid="road-spatial-import-left-out">
            Left out, because this import does not take them:{' '}
            {leftOut.map((group) => counted(group.features.length, STATED_NOUNS[group.role])).join(', ')}.
          </p>
        )}
      </div>
    </PanelDialog>
  )
}
