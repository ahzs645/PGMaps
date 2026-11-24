import { Upload } from 'lucide-react'
import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { filesFromDrop, type PickedFile } from '@/components/ui/picked-files'
import { cn } from '@/lib/utils'

function carriesFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

type DropReceiver =
  /** Plain files; a dropped folder arrives as nothing the browser can read. */
  | { onFiles: (files: File[]) => void; onPickedFiles?: never; onError?: never }
  /** Files with their paths, walking dropped folders (`filesFromDrop`). */
  | { onPickedFiles: (files: PickedFile[]) => void; onError: (error: unknown) => void; onFiles?: never }

export type FileDropOptions = DropReceiver & {
  label?: string
  /** Second line in the overlay, e.g. the accepted formats. */
  hint?: ReactNode
  disabled?: boolean
}

/**
 * The drop behaviour of `FileDropTarget` for an element the caller already renders: spread
 * `dropProps` on it (it must be positioned) and render `overlay` inside it, as its last child:
 * placed first it shifts every `:first-child` rule on the element's real children (the
 * road designer's ribbon moved down 12 px on every drag). Text and links
 * dragged over it are ignored. A drop field inside that takes its own drop (it calls
 * `preventDefault` on `dragover` and `drop`) keeps it: the overlay steps aside over it and the
 * drop is not handed over twice.
 */
export function useFileDrop({
  label = 'Drop files to add them to the map',
  hint,
  disabled = false,
  ...receiver
}: FileDropOptions) {
  const [dragging, setDragging] = useState(false)
  // dragenter/dragleave fire for every child element crossed; count them.
  const depth = useRef(0)

  const reset = () => {
    depth.current = 0
    setDragging(false)
  }

  const dropProps = {
    onDragEnter: (event: DragEvent) => {
      if (disabled || !carriesFiles(event)) return
      event.preventDefault()
      depth.current += 1
      setDragging(true)
    },
    onDragOver: (event: DragEvent) => {
      if (disabled || !carriesFiles(event)) return
      // An inner drop field has taken this one.
      if (event.defaultPrevented) {
        setDragging(false)
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDragging(true)
    },
    onDragLeave: (event: DragEvent) => {
      if (disabled || !carriesFiles(event)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    },
    onDrop: (event: DragEvent) => {
      if (disabled || !carriesFiles(event)) return
      reset()
      if (event.defaultPrevented) return
      event.preventDefault()
      const { onPickedFiles, onError } = receiver
      if (onPickedFiles) {
        // Entries must be taken inside the event; `filesFromDrop` does so before it awaits.
        filesFromDrop(event.dataTransfer).then((files) => {
          if (files.length > 0) onPickedFiles(files)
        }, onError)
        return
      }
      const files = Array.from(event.dataTransfer.files)
      if (files.length > 0) receiver.onFiles?.(files)
    },
  }

  const overlay = dragging ? (
    <div
      role="status"
      className="pointer-events-none absolute inset-2 z-[60] flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-primary bg-background/80 text-center backdrop-blur-[1px]"
    >
      <Upload className="size-6 text-primary" aria-hidden="true" />
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {hint && <span className="max-w-xs text-xs text-muted-foreground">{hint}</span>}
    </div>
  ) : null

  return { dragging, dropProps: { ...dropProps, 'data-file-drop-target': '' }, overlay }
}

/**
 * Accepts files dropped anywhere on its children (typically a map) and shows a
 * full-size "drop to add" overlay while files are dragged over it. The parent reads
 * the files. A page that cannot add a wrapper uses `useFileDrop` on its own element.
 */
export function FileDropTarget({
  children,
  className,
  ...options
}: FileDropOptions & { children: ReactNode; className?: string }) {
  const { dropProps, overlay } = useFileDrop(options)
  return (
    <div className={cn('relative', className)} {...dropProps}>
      {children}
      {overlay}
    </div>
  )
}
