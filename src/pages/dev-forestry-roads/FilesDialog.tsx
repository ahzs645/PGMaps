import { useState, type ReactNode } from 'react'
import { Download, FileDown, FileJson, FolderOpen, Map as MapIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { Field, roadFieldClass } from './Controls'
import type { FileKind } from './DesignSidebarBody'
import type { RoadReportSettings } from './reportSettings'
import { ReportSettingsEditor } from './ReportSettingsEditor'

export type RoadExport =
  | 'project'
  | 'geojson'
  | 'csv'
  | 'report'
  | 'report-pdf'
  | 'map-pdf'
  | 'landxml'
  | 'stakeout'
  | 'shapefile'
  | 'plotbook'
  | 'terrain-landxml'
  | 'terrain-ascii'

export function FilesDialog({
  open,
  onOpenChange,
  name,
  onName,
  onFile,
  onSave,
  busy,
  portalContainer,
  reportSettings,
  onReportSettings,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onName: (name: string) => void
  onFile: (kind: FileKind) => void
  onSave: (kind: RoadExport) => void
  busy: boolean
  portalContainer?: HTMLElement | null
  reportSettings?: RoadReportSettings
  onReportSettings?: (settings: RoadReportSettings) => void
}) {
  const [drawingSetup, setDrawingSetup] = useState(false)
  const group = (title: string, children: ReactNode) => (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  )
  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Save & export"
      subtitle="Project files, maps and reports"
      size="lg"
      portalContainer={portalContainer}
      contentProps={{ 'data-testid': 'road-files-dialog' }}
    >
      <fieldset disabled={busy} className="space-y-6">
        {group(
          'Project',
          <>
            <Field label="Project name">
              <input
                className={roadFieldClass}
                value={name}
                maxLength={200}
                onChange={(event) => onName(event.target.value)}
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={() => onSave('project')}>
                <FileJson className="size-4" />
                Save project JSON
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false)
                  onFile('project')
                }}
              >
                <FolderOpen className="size-4" />
                Open project
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Keeps alternatives, design controls, templates and terrain provenance. Imported DEM cells are included;
              published LiDAR restores its recorded checksum. Autosave stays on this device.
            </p>
          </>,
        )}
        {group(
          'PDF documents',
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={() => onSave('map-pdf')}>
              <MapIcon className="size-4" />
              Map PDF
            </Button>
            <Button variant="outline" onClick={() => onSave('report-pdf')}>
              <FileDown className="size-4" />
              Report PDF
            </Button>
          </div>,
        )}
        {group(
          'Data & design',
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['geojson', 'Export GeoJSON'],
                ['csv', 'Station CSV'],
                ['landxml', 'LandXML'],
                ['stakeout', 'Stakeout CSV'],
                ['shapefile', 'Shapefile (zip)'],
                ['plotbook', `Plot book (${reportSettings?.paper ?? 'A3'})`],
                ['terrain-landxml', 'Terrain surface LandXML'],
                ['terrain-ascii', 'Terrain ASCII grid'],
                ['report', 'Report HTML'],
              ] as const
            ).map(([kind, label]) => (
              <Button key={kind} variant="outline" onClick={() => onSave(kind)}>
                <Download className="size-3" />
                {label}
              </Button>
            ))}
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                onFile('alignment')
              }}
            >
              Import road lines
            </Button>
          </div>,
        )}
        {onReportSettings &&
          group(
            'Drawing setup',
            <>
              <Button
                size="sm"
                variant="outline"
                aria-expanded={drawingSetup}
                onClick={() => setDrawingSetup(!drawingSetup)}
              >
                Configure plot book
              </Button>
              {drawingSetup && <ReportSettingsEditor value={reportSettings} onChange={onReportSettings} />}
            </>,
          )}
      </fieldset>
      <a
        className="mt-5 inline-block text-xs text-muted-foreground underline"
        href="https://github.com/ahzs645/PGMaps/blob/HEAD/docs/forestry-road-design.md"
        target="_blank"
        rel="noreferrer"
      >
        Methods & calculation limits
      </a>
    </PanelDialog>
  )
}
