import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { brandVariables, fontCss } from './presentation'
import { useBranding } from './useBranding'
import type { BrandSurface } from './model'
import './branding.css'

export function BrandScope({ children, surface = 'workspace' }: { children: ReactNode; surface?: BrandSurface }) {
  const { brands, settings } = useBranding()
  const brand = settings[surface] ? brands.find((b) => b.key === settings.selected) : undefined
  useEffect(() => {
    if (surface !== 'help' || !brand) return
    const style = document.documentElement.style,
      values = brandVariables(brand, settings.typography, true)
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, style.getPropertyValue(key)]))
    for (const [key, value] of Object.entries(values)) style.setProperty(key, value)
    return () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value) style.setProperty(key, value)
        else style.removeProperty(key)
      }
    }
  }, [brand, settings.typography, surface])
  return (
    <div
      className="brand-scope"
      data-brand-surface={surface}
      data-brand-id={brand?.profile.id}
      data-brand-typography={(!!brand && settings.typography) || undefined}
      style={brand ? (brandVariables(brand, settings.typography, surface === 'help') as CSSProperties) : undefined}
    >
      {brand && settings.typography && <style>{fontCss(brand)}</style>}
      {children}
    </div>
  )
}
