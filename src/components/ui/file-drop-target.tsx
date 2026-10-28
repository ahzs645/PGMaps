import { Upload } from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

function carriesFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/**
 * Accepts files dropped anywhere on its children (typically a map) and shows a
 * full-size "drop to add" overlay while files are dragged over it. Text and
 * links dragged over it are ignored. The parent reads the files.
 */
export function FileDropTarget({
  onFiles,
  children,
  label = 'Drop files to add them to the map',
  hint,
  disabled = false,
  className,
}: {
  onFiles: (files: File[]) => void
  children: ReactNode
  label?: string
  /** Second line in the overlay, e.g. the accepted formats. */
  hint?: ReactNode
  disabled?: boolean
  className?: string
}) {
  const [dragging, setDragging] = useState(false)
  // dragenter/dragleave fire for every child element crossed; count them.
  const depth = useRef(0)

  const reset = () => {
    depth.current = 0
    setDragging(false)
  }

  return (
    <div
      className={cn('relative', className)}
      data-file-drop-target=""
      onDragEnter={(event) => {
        if (disabled || !carriesFiles(event)) return
        event.preventDefault()
        depth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (disabled || !carriesFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(event) => {
        if (disabled || !carriesFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      }}
      onDrop={(event) => {
        if (disabled || !carriesFiles(event)) return
        event.preventDefault()
        reset()
        const files = Array.from(event.dataTransfer.files)
        if (files.length > 0) onFiles(files)
      }}
    >
      {children}
      {dragging && (
        <div
          role="status"
          className="pointer-events-none absolute inset-2 z-[60] flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-background/80 text-center backdrop-blur-[1px]"
        >
          <Upload className="size-6 text-primary" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">{label}</span>
          {hint && <span className="max-w-xs text-xs text-muted-foreground">{hint}</span>}
        </div>
      )}
    </div>
  )
}
