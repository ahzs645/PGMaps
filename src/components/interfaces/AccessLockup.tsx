import { logoDataUrl, type BrandSurface } from '../../branding/model'
import { useBranding } from '../../branding/useBranding'

export function AccessLockup({
  compact = false,
  surface = 'workspace',
}: {
  compact?: boolean
  surface?: BrandSurface
}) {
  const { brands, settings } = useBranding()
  const brand = settings[surface] ? brands.find((b) => b.key === settings.selected) : undefined
  if (brand)
    return (
      <span className="brand-logo" data-brand-surface={surface} data-compact={compact || undefined}>
        <img className="brand-logo-light" src={logoDataUrl(brand.profile.logos.primary)} alt={brand.profile.name} />
        <img className="brand-logo-dark" src={logoDataUrl(brand.profile.logos.reverse)} alt={brand.profile.name} />
      </span>
    )
  return (
    <span
      data-brand-surface={surface}
      className={compact ? 'access-lockup access-lockup-compact' : 'access-lockup'}
      role="img"
      aria-label="DDC Access"
    >
      <span>Access</span>
    </span>
  )
}
