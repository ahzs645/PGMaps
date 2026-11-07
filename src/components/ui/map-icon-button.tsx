import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const TONES = {
  neutral: 'border-border bg-background/95 text-foreground',
  sky: 'border-sky-700 bg-sky-50 text-sky-800',
  blue: 'border-blue-600 bg-background/95 text-blue-700',
}

/**
 * The square icon button a map marker draws. Give it an SVG icon, never a text glyph: a glyph sits
 * wherever its font's metrics put it (a math symbol like ≈ rides high) and sizes the box to itself,
 * whereas the fixed box and flex centring here put an icon on the marker's exact coordinate.
 */
export const MapIconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof TONES }
>(function MapIconButton({ tone = 'neutral', className, type = 'button', ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'flex size-6 items-center justify-center rounded-md border p-0 leading-none shadow-sm [&_svg]:size-3.5 [&_svg]:shrink-0',
        TONES[tone],
        className,
      )}
      {...props}
    />
  )
})
