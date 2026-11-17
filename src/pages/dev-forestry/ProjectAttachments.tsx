import { useEffect, useRef, useState } from 'react'
import { FileButton } from '@/components/ui/file-button'
import { TextButton } from '@/components/ui/text-button'
import { downloadBlob } from '@/lib/download'
import type { ProjectAttachment } from './projectArchive'

function previewType(name: string) {
  if (/\.jpe?g$/i.test(name)) return 'image/jpeg'
  if (/\.png$/i.test(name)) return 'image/png'
  if (/\.webp$/i.test(name)) return 'image/webp'
  if (/\.pdf$/i.test(name)) return 'application/pdf'
  if (/\.(md|txt|geojson|json|csv)$/i.test(name)) return 'text/plain'
  return null
}

function AttachmentPreview({ file }: { file: ProjectAttachment }) {
  const type = previewType(file.name)
  const image = useRef<HTMLImageElement>(null)
  const link = useRef<HTMLAnchorElement>(null)
  useEffect(() => {
    if (!type) return
    const url = URL.createObjectURL(file.blob.slice(0, file.blob.size, type))
    if (image.current) image.current.src = url
    if (link.current) link.current.href = url
    return () => URL.revokeObjectURL(url)
  }, [file, type])
  if (!type) return null
  return (
    <div className="space-y-2">
      {type.startsWith('image/') && (
        <img ref={image} alt={file.name} className="w-full rounded-md border border-border" />
      )}
      <a ref={link} className="text-xs underline" target="_blank" rel="noopener noreferrer">
        Open {file.name} in a new tab
      </a>
    </div>
  )
}

export function ProjectAttachments({
  title,
  files,
  onAdd,
  onRemove,
}: {
  title: string | null
  files: ProjectAttachment[]
  onAdd: (files: File[]) => void
  onRemove: (file: ProjectAttachment) => void
}) {
  const [selected, setSelected] = useState<ProjectAttachment | null>(null)
  const index = selected ? files.indexOf(selected) : -1
  return (
    <div className="space-y-2">
      {title && <p className="mt-2 text-xs font-medium">{title}</p>}
      <details className="mt-2 space-y-2">
        <summary className="cursor-pointer text-xs font-medium">Project attachments ({files.length})</summary>
        <FileButton label="Attach files to project" multiple onFiles={onAdd}>
          Attach files…
        </FileButton>
        {!!files.length && (
          <select
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs"
            aria-label="Project attachment"
            value={index < 0 ? '' : index}
            onChange={(event) =>
              setSelected(event.target.value === '' ? null : (files[Number(event.target.value)] ?? null))
            }
          >
            <option value="">Choose a file</option>
            {files.map((file, i) => (
              <option key={i} value={i}>
                {file.name}
              </option>
            ))}
          </select>
        )}
        {selected && index >= 0 && (
          <>
            <AttachmentPreview file={selected} />
            <div className="flex flex-wrap gap-x-3">
              <TextButton onClick={() => downloadBlob(selected.blob, selected.name)}>Download attachment</TextButton>
              <TextButton
                onClick={() => {
                  onRemove(selected)
                  setSelected(null)
                }}
              >
                Remove attachment
              </TextButton>
            </div>
          </>
        )}
      </details>
    </div>
  )
}
