// Keep the launching workspace and the available Ribbon tutorial in every help link.
(() => {
  const params = new URLSearchParams(location.search)
  const id = params.get('interface')
  const ribbonId = params.get('ribbonInterface') || id
  if (location.protocol === 'file:') return
  const nav = document.querySelector('.tour-nav[data-lesson]')
  if (nav && params.get('layout') === 'ribbon') {
    const target = new URL(nav.querySelector('a[href*="ribbon.html?"]').href)
    if (ribbonId) target.searchParams.set('interface', ribbonId)
    location.replace(target)
    return
  }
  if (!id) return
  for (const a of document.querySelectorAll('a[href]')) {
    const raw = a.getAttribute('href')
    if (a.hasAttribute('download') || raw.startsWith('#')) continue
    const url = new URL(raw, location.href)
    const helpPage = /\/(?:tour|ribbon|index)\.html$/.test(url.pathname) || raw.startsWith('?layout=')
    const workspace = /\/dev\/forestry\/road-design\/?$/.test(url.pathname)
    if (url.origin !== location.origin || (!helpPage && !workspace)) continue
    const ribbon = /\/ribbon\.html$/.test(url.pathname) || url.searchParams.get('layout') === 'ribbon'
    url.searchParams.set('interface', ribbon ? ribbonId : id)
    if (!ribbon && !workspace && params.has('ribbonInterface'))
      url.searchParams.set('ribbonInterface', ribbonId)
    a.href = url.href
  }
})()
