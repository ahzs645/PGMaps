import { X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const MOBILE_FEATURE_CARD_MEDIA_QUERY = '(max-width: 767px)'
export const MOBILE_FEATURE_CARD_HEIGHT = 360

export function MobileFeatureCard({
  title,
  subtitle,
  children,
  className,
  contentClassName,
  height = MOBILE_FEATURE_CARD_HEIGHT,
  onClose,
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
  height?: number
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const closeWithAnimation = useCallback(() => {
    setOpen(false)
    window.setTimeout(onClose, 240)
  }, [onClose])

  return (
    <div className="pointer-events-none fixed inset-0 z-50 md:hidden" aria-label="Selected feature">
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 pointer-events-none grid transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
        style={{ height: `min(${height}px, calc(100dvh - 6.5rem))` }}
      >
        <div
          role="dialog"
          className={cn(
            'pointer-events-auto col-start-1 row-start-1 flex h-full self-end translate-y-2 flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)] transition-[height,transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            className,
          )}
        >
          <div className="flex justify-center py-2" aria-hidden="true">
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <header className="border-b border-border px-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-base font-semibold leading-tight text-foreground">
                  {title}
                </div>
                {subtitle ? (
                  <div className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
                    {subtitle}
                  </div>
                ) : null}
              </div>
              <button type="button" className="shrink-0 rounded-md p-2 hover:bg-muted" aria-label="Close feature card" onClick={closeWithAnimation}>
                <X className="size-4" />
              </button>
            </div>
          </header>
          <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]', contentClassName)}>
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
