// A Workbench URL can carry the Ribbon layout to return to when switching back.
(() => {
  const params = new URLSearchParams(location.search)
  const id = params.get('interface')
  if (location.protocol === 'file:') return
  const nav = document.querySelector('.tour-nav[data-lesson]')
  if (nav && params.get('layout') === 'ribbon') {
    const target = new URL(nav.querySelector('a[href*="ribbon.html?"]').href)
    if (id) target.searchParams.set('interface', id)
    location.replace(target)
    return
  }
  if (!id) return
  for (const a of document.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href')
    if (a.hasAttribute('download') || raw.startsWith('#')) continue
    const url = new URL(raw, location.href)
    const helpPage = /\/(?:tour|ribbon|index)\.html$/.test(url.pathname) || raw.startsWith('?layout=')
    if (url.origin !== location.origin || !helpPage) continue
    url.searchParams.set('interface', id)
    a.href = url.href
  }
})()
