import { useRef, useState } from 'react'
import { FileUp, FolderOpen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormField, NativeSelect } from '@/components/ui/form-field'
import { InlineAlert, SidebarSection } from '@/components/ui/map-panels'
import { filesFromDrop, filesFromInput } from '../dev-avast/gdal'
import { THLB_SOURCES } from './sources'
import type { Fields, InputRole } from './types'
import type { InputEntry, useInputs } from './useInputs'

type Inputs = ReturnType<typeof useInputs>
const ROLES: Array<{ role: InputRole; title: string; hint: string }> = [
  {
    role: 'areas',
    title: 'Assessment areas',
    hint: 'Proposed WHAs or other polygons. Choose a unique area ID; supply all parts of a shapefile together.',
  },
  {
    role: 'official',
    title: 'Official TSR THLB',
    hint: 'One or more TSA/TFL geodatabases. Select thlb_fact (0–1) and the TSR year where available.',
  },
  {
    role: 'proxy',
    title: 'Proxy THLB (optional)',
    hint: 'Public provincial proxy vector geodatabase. Select pthlb_fact (0–1). Fills gaps in official coverage; null means zero per the catalogue.',
  },
  {
    role: 'vri',
    title: 'Forest age (optional)',
    hint: 'VRI rank-1 polygons with PROJ_AGE_1. Missing age stays unclassified; confirm the inventory reference year.',
  },
  {
    role: 'deferral',
    title: 'Old-growth deferrals (optional)',
    hint: 'Supply a complete deferral mask for the assessment area. Intersections count once. OGMAs are a different designation.',
  },
  {
    role: 'admin',
    title: 'TSA/TFL boundaries (optional)',
    hint: 'Administrative polygons with a name or ID field. Used for the workbook breakdown.',
  },
]
const ACCEPT = '.shp,.shx,.dbf,.prj,.cpg,.zip,.geojson,.json,.gpkg,.kml,.fgb'

function Entry({ entry, inputs, disabled }: { entry: InputEntry; inputs: Inputs; disabled: boolean }) {
  const layer = entry.layers.find((item) => item.name === entry.layer)
  const fields = layer?.fields.map((field) => field.name) ?? []
  const select = (field: keyof Fields, label: string, required = false) => (
    <FormField label={label} key={field}>
      <NativeSelect
        value={entry.fields[field]}
        disabled={disabled}
        onChange={(event) =>
          inputs.update(entry.dataset.id, { fields: { ...entry.fields, [field]: event.target.value } })
        }
      >
        <option value="">{required ? 'Choose a field…' : 'Not supplied'}</option>
        {fields.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </NativeSelect>
    </FormField>
  )
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-3" data-thlb-entry={entry.role}>
      <div className="flex items-start justify-between gap-2">
        <p className="break-all text-xs font-medium">{entry.dataset.label}</p>
        <Button
          size="icon"
          variant="ghost"
          disabled={disabled}
          aria-label={`Remove ${entry.dataset.label}`}
          onClick={() => inputs.remove(entry.dataset.id)}
          className="h-7 w-7 shrink-0"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {entry.status === 'reading' && <InlineAlert loading>Reading layers…</InlineAlert>}
      {entry.status === 'error' && <InlineAlert tone="error">{entry.error}</InlineAlert>}
      {entry.status === 'ready' && (
        <>
          <FormField label="Layer">
            <NativeSelect
              value={entry.layer}
              disabled={disabled}
              onChange={(event) => inputs.setLayer(entry, event.target.value)}
            >
              {entry.layers.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <p className="text-xs text-muted-foreground">
            {layer?.featureCount.toLocaleString()} features · {layer?.crs || 'CRS checked when reading'}
          </p>
          {entry.role === 'areas' && select('id', 'Assessment ID', true)}
          {(entry.role === 'official' || entry.role === 'proxy') && (
            <>
              {select('factor', 'THLB factor (fraction 0–1)', true)}
              {select('year', 'TSR report year')}
              {select('name', 'Administrative name (optional)')}
            </>
          )}
          {entry.role === 'vri' && select('age', 'Projected age (years)', true)}
          {entry.role === 'admin' && select('name', 'Administrative name', true)}
        </>
      )}
    </div>
  )
}

function RoleInput({
  role,
  title,
  hint,
  inputs,
  disabled,
}: (typeof ROLES)[number] & { inputs: Inputs; disabled: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const add: Inputs['add'] = async (target, files) => {
    setError(null)
    try {
      await inputs.add(target, files)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <SidebarSection title={title}>
      <div
        className="space-y-3"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          if (!disabled)
            void filesFromDrop(event.dataTransfer)
              .then((files) => add(role, files))
              .catch((cause) => setError(String(cause)))
        }}
      >
        <p className="text-xs leading-5 text-muted-foreground">{hint}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => fileRef.current?.click()}>
            <FileUp className="mr-1 h-4 w-4" />
            Add files
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => folderRef.current?.click()}>
            <FolderOpen className="mr-1 h-4 w-4" />
            Add .gdb folder
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          aria-label={`${title} files`}
          data-thlb-files={role}
          disabled={disabled}
          onChange={(event) => {
            const files = filesFromInput(event.target.files)
            event.target.value = ''
            void add(role, files)
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          aria-label={`${title} folder`}
          {...{ webkitdirectory: '', directory: '' }}
          disabled={disabled}
          onChange={(event) => {
            const files = filesFromInput(event.target.files)
            event.target.value = ''
            void add(role, files)
          }}
        />
        {error && <InlineAlert tone="error">{error}</InlineAlert>}
        {inputs.entries
          .filter((entry) => entry.role === role)
          .map((entry) => (
            <Entry key={entry.dataset.id} entry={entry} inputs={inputs} disabled={disabled} />
          ))}
      </div>
    </SidebarSection>
  )
}

export function InputsPanel({ inputs, disabled }: { inputs: Inputs; disabled: boolean }) {
  return (
    <>
      <SidebarSection title="Public data sources">
        <p className="mb-2 text-xs leading-5 text-muted-foreground">
          Download the data, then add the ZIP or geodatabase below. Files are read locally; nothing is uploaded.
        </p>
        <div className="flex flex-col gap-2 text-xs">
          <a className="text-primary underline" href={THLB_SOURCES.official.download} target="_blank" rel="noreferrer">
            Official THLB: TSA and available TFL downloads ↗
          </a>
          <a className="text-primary underline" href={THLB_SOURCES.proxy.download} target="_blank" rel="noreferrer">
            Download public Proxy THLB (ZIP, about 279 MB) ↗
          </a>
          <a className="text-primary underline" href={THLB_SOURCES.proxy.catalogue} target="_blank" rel="noreferrer">
            Proxy catalogue, use conditions and methodology ↗
          </a>
        </div>
      </SidebarSection>
      {ROLES.map((role) => (
        <RoleInput key={role.role} {...role} inputs={inputs} disabled={disabled} />
      ))}
    </>
  )
}
