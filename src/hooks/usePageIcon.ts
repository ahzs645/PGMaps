import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import pageIconsConfig from '@/config/page-icons.json'
import { withBase } from '@/lib/dataUrl'
import { iconType, pageIconFor, parsePageIcons } from '@/lib/pageIcons'

const PAGE_ICONS = parsePageIcons(pageIconsConfig)

/**
 * Show the current route's tab icon from `src/config/page-icons.json` (`docs/page-icons.md`). Mounted
 * once, in the app shell: a page never sets its own icon.
 */
export function usePageIcon() {
  const { pathname } = useLocation()
  const icon = pageIconFor(PAGE_ICONS, pathname)
  useEffect(() => {
    const href = withBase(`/${icon}`)
    const current = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (current?.getAttribute('href') === href) return
    // A new element rather than a new href: Safari keeps showing the old icon when only the href changes.
    const link = document.createElement('link')
    link.rel = 'icon'
    link.type = iconType(icon)
    link.href = href
    if (current) current.replaceWith(link)
    else document.head.appendChild(link)
  }, [icon])
}
