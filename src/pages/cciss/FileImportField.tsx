import { useId, type ReactNode } from 'react'
import { FileDropField } from '@/components/ui/file-drop-field'

/**
 * One local file for an import: a named `FileDropField` that takes the first file picked or dropped.
 * The hidden input carries `label` as its name, so tests and assistive technology find it by that.
 * The heading is plain text rather than a `<label>`, which would name the button inside it instead.
 */
export function FileImportField({
  label,
  description,
  accept,
  buttonLabel = 'Choose file',
  dropHint,
  disabled,
  onFile,
  onError,
}: {
  label: string
  description?: ReactNode
  accept: string
  buttonLabel?: string
  dropHint?: string
  disabled?: boolean
  onFile: (file: File) => void
  onError?: (error: unknown) => void
}) {
  const descriptionId = useId()
  return (
    <div className="min-w-0">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <FileDropField
        label={label}
        accept={accept}
        multiple={false}
        filesLabel={buttonLabel}
        dropHint={dropHint}
        disabled={disabled}
        onFiles={(files) => {
          if (files[0]) onFile(files[0].file)
        }}
        onError={onError}
        inputProps={{ 'aria-label': label, 'aria-describedby': description ? descriptionId : undefined }}
      />
      {description && (
        <p id={descriptionId} className="mt-1 text-xs leading-4 text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  )
}
