import { Calculator } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AddToIndexLabLinkProps {
  quick: 'airQuality' | 'parks' | 'transit' | 'crime' | 'foodSafety' | 'walkability' | 'heatShade' | 'canue'
  label?: string
  className?: string
}

export function AddToIndexLabLink({ quick, label = 'Add to Index Lab', className }: AddToIndexLabLinkProps) {
  return (
    <a
      href={`/score-builder?quick=${quick}`}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md border border-cyan-300 bg-cyan-50 px-3 py-2 text-xs font-semibold text-cyan-900 transition-colors hover:bg-cyan-100 dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-100 dark:hover:bg-cyan-950/50',
        className,
      )}
    >
      <Calculator className="h-3.5 w-3.5" />
      {label}
    </a>
  )
}
