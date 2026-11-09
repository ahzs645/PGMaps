import { Button } from '@/components/ui/button'

export interface DownloadAction {
  label: string
  onClick: () => void
  disabled?: boolean
}

/** A row of export buttons. The first is the main export unless `outline`; the rest are outlined. */
export function DownloadActions({ actions, outline = false }: { actions: DownloadAction[]; outline?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action, index) => (
        <Button
          key={action.label}
          variant={outline || index > 0 ? 'outline' : 'default'}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
    </div>
  )
}
