import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download, File as FileIcon, FileImage, FileJson, FileText, Paperclip, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmRemoveButton } from '@/components/ui/confirm-remove'
import { PanelDialog } from '@/components/ui/dialog-shell'
import { FileButton } from '@/components/ui/file-button'
import { FileDropTarget } from '@/components/ui/file-drop-target'
import { EmptyHint, ResultRow, ResultRowDetail } from '@/components/ui/result-list'
import { downloadBlob } from '@/lib/download'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PHOTO_REMOVE_DETAIL } from './photoOptions'
import type { ProjectAttachment } from './projectArchive'

function previewType(name: string) {
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.webp$/i.test(name)) return 'image/webp'
  if (/\.pdf$/i.test(name)) return 'application/pdf'
  if (/\.(md|txt|geojson|json|csv)$/i.test(name)) return 'text/plain'
  return null
}

function fileKind(name: string) {
  if (/\.(jpe?g|png|webp|heic|heif|tiff?)$/i.test(name)) return { label: 'Image', Icon: FileImage }
  if (/\.(json|geojson)$/i.test(name)) return { label: 'JSON', Icon: FileJson }
  if (/\.pdf$/i.test(name)) return { label: 'PDF', Icon: FileText }
  if (/\.(md|txt|csv)$/i.test(name)) return { label: 'Text', Icon: FileText }
  const extension = /\.([a-z0-9]{1,8})$/i.exec(name)?.[1]
  return { label: extension ? extension.toUpperCase() : 'File', Icon: FileIcon }
}

export function AttachmentPreview({ file, page }: { file: ProjectAttachment; page?: string }) {
  const type = previewType(file.name)
  const image = useRef<HTMLImageElement>(null)
  const link = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (!type) return
    const url = URL.createObjectURL(file.blob.slice(0, file.blob.size, type))
    if (image.current) image.current.src = url
    if (link.current)
      link.current.href = type === 'application/pdf' && page && /^[1-9]\d*$/.test(page) ? url + '#page=' + page : url
    return () => URL.revokeObjectURL(url)
  }, [file, type, page])
  if (!type) return null
  return (
    <div className="space-y-2">
      {type.startsWith('image/') && (
        <img ref={image} alt={file.name} className="w-full rounded-md border border-border" />
      )}
      <a ref={link} className="text-xs underline" target="_blank" rel="noopener noreferrer">
        Open {file.name}
        {page ? ` (page ${page})` : ''} in a new tab
      </a>
    </div>
  )
}

/**
 * The header's paperclip: how many files the project carries, and the way to them. A count badge rather than a label,
 * so the bar beside the layout picker stays one row.
 */
export function ProjectAttachmentsButton({ count, onClick }: { count: number; onClick: () => void }) {
  const label = `Project attachments (${count})`
  return (
    <Button
      type="button"
      size="icon"
      variant="outline"
      className="relative size-8"
      aria-label={label}
      title={label}
      data-testid="visuals-attachments-button"
      onClick={onClick}
    >
      <Paperclip className="size-4" aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-primary px-1 text-center text-3xs font-semibold leading-4 text-primary-foreground tabular-nums"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Button>
  )
}

/**
 * The files a project carries: the original VIA sheets, a case.json, a photo's original. They go into the project ZIP
 * from Save & export (whose *What goes in* lists them) and come back when it is opened. A file that is a field record's
 * original (`recordId`) is removed with its record, through `onRemove`, never on its own. Every row carries its own
 * Download and the shared bin (`ConfirmRemoveButton`), as Field records and the photo strip do, so removing a file asks
 * the same question wherever it is done; *Remove all* sits in the toolbar beside the count.
 */
export function ProjectAttachmentsDialog({
  open,
  onOpenChange,
  title,
  files,
  onAdd,
  onRemove,
  linkedTo,
  footer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The opened project's name, if a project file was opened. */
  title: string | null
  files: ProjectAttachment[]
  onAdd: (files: File[]) => void
  onRemove: (file: ProjectAttachment) => void
  /** What a file belongs to (a field record's name), or null for a file attached on its own. */
  linkedTo: (file: ProjectAttachment) => string | null
  /** Work that reads these files, such as the historical VIA review. */
  footer?: ReactNode
}) {
  const [selected, setSelected] = useState<ProjectAttachment | null>(null)
  const shown = selected && files.includes(selected) ? selected : null
  const total = files.reduce((sum, file) => sum + file.blob.size, 0)
  const linkedCount = files.filter((file) => linkedTo(file)).length
  return (
    <PanelDialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Project attachments"
      subtitle={
        (title ? `${title} · ` : '') +
        'Saved in the project ZIP from Save & export and reopened with it. Read in this browser, never uploaded.'
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          <FileButton label="Attach files to project" multiple variant="outline" onFiles={onAdd}>
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Attach files…
          </FileButton>
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {files.length} {files.length === 1 ? 'file' : 'files'}
            {files.length ? ` · ${formatBytes(total)}` : ''}
          </span>
          {files.length > 1 && (
            <ConfirmRemoveButton
              label="Remove all project attachments"
              question={`Remove all ${files.length} files?`}
              detail={
                linkedCount
                  ? `Field photos' records go with their originals (${linkedCount} of them). A viewpoint made from one stays, without the link.`
                  : 'The files go from the project.'
              }
              confirmLabel="Remove all"
              onConfirm={() => {
                files.forEach(onRemove)
                setSelected(null)
              }}
            >
              Remove all
            </ConfirmRemoveButton>
          )}
        </div>
      }
      footer={footer}
      contentProps={{ 'data-testid': 'visuals-attachments-dialog' }}
    >
      <FileDropTarget onFiles={onAdd} label="Drop files to attach them to the project">
        {files.length ? (
          <ul className="divide-y divide-border overflow-hidden rounded-md border border-border">
            {files.map((file, index) => {
              const { label, Icon } = fileKind(file.name)
              const linked = linkedTo(file)
              const isSelected = file === shown
              return (
                <li key={`${file.name}-${index}`}>
                  <div className="flex items-center gap-1 pr-2">
                    <ResultRow
                      className="min-w-0 flex-1"
                      leading={<Icon className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />}
                      title={file.name}
                      subtitle={[label, formatBytes(file.blob.size), linked].filter(Boolean).join(' · ')}
                      selected={isSelected}
                      onClick={() => setSelected(isSelected ? null : file)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 text-muted-foreground"
                      aria-label={`Download ${file.name}`}
                      title={`Download ${file.name}`}
                      onClick={() => downloadBlob(file.blob, file.name)}
                    >
                      <Download aria-hidden />
                    </Button>
                    <ConfirmRemoveButton
                      label={`Remove ${file.name}`}
                      question={`Remove ${file.name}?`}
                      detail={linked ? `${linked}. ${PHOTO_REMOVE_DETAIL}` : 'The file goes from the project.'}
                      onConfirm={() => {
                        onRemove(file)
                        if (isSelected) setSelected(null)
                      }}
                    />
                  </div>
                  {isSelected && (
                    <ResultRowDetail>
                      <AttachmentPreview file={file} />
                    </ResultRowDetail>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyHint className={cn('space-y-1')}>
            <p>No files attached.</p>
            <p>
              Attach the original VIA sheets, a case.json or other evidence, or drop them here. A field photo&apos;s
              original is attached when it is added.
            </p>
          </EmptyHint>
        )}
      </FileDropTarget>
    </PanelDialog>
  )
}
