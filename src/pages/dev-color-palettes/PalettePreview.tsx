import { paletteContrast, paletteInterpolator, type PaletteSampling } from '@/lib/paletteScale'

interface Props {
  title: string
  dark: boolean
  colors: string[]
  sampling?: PaletteSampling
  opacity: number
}

/** Fixed light/dark surfaces are the specimens being compared, not app chrome. */
export function PalettePreview({ title, dark, colors, sampling, opacity }: Props) {
  const background = dark ? '#0a0a0a' : '#ffffff'
  const text = dark ? '#fafafa' : '#111827'
  const gradient = sampling
    ? Array.from({ length: 41 }, (_, i) => `${paletteInterpolator(sampling)(i / 40)} ${i * 2.5}%`).join(', ')
    : null
  return (
    <section className="min-w-0 rounded-lg border p-4" style={{ background, color: text }} aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <div
        className="my-4 flex h-14 gap-0.5"
        role="img"
        aria-label={`${colors.length} colour steps on ${dark ? 'dark' : 'light'} background`}
      >
        {colors.map((c, i) => (
          <span key={i} className="min-w-0 flex-1" title={c} style={{ background: c, opacity }} />
        ))}
      </div>
      {gradient && (
        <div
          className="mb-4 h-4"
          role="img"
          aria-label="Continuous gradient over the same palette range"
          style={{ background: `linear-gradient(to right, ${gradient})`, opacity }}
        />
      )}
      <div className="flex flex-wrap gap-4 text-xs">
        <span className="inline-flex items-center gap-2">
          <span
            className="h-5 w-5 rounded-full"
            style={{ background: colors[Math.floor(colors.length / 2)], border: `2px solid ${text}` }}
          />
          Boundary
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            className="h-5 w-5 rounded-full"
            style={{ background: colors[0], border: '2px solid #38bdf8', boxShadow: `0 0 0 2px ${text}` }}
          />
          Selection + halo
        </span>
      </div>
      <p className="mt-4 text-xs leading-5">
        Fill/background ratios: {colors.map((c) => paletteContrast(c, background, opacity).toFixed(2)).join(' · ')}
      </p>
    </section>
  )
}
