// One catalog supplies the links for both workspace styles.
const params = new URLSearchParams(location.search)
const layoutId = params.get('ribbonInterface') || params.get('interface') || 'ribbon'
function ribbonUrl(lesson, view, prefix = '') {
  return prefix + 'ribbon.html?' + new URLSearchParams({ lesson, view, interface: layoutId })
}
const chooser = document.querySelector('.workspace-choice')
if (chooser) {
  const ribbon = params.get('layout') === 'ribbon'
  chooser.querySelector(ribbon ? '[data-ribbon]' : '[data-workbench]').setAttribute('aria-current', 'page')
  if (ribbon) {
    chooser.querySelector('[data-ribbon]').href =
      '?' + new URLSearchParams({ layout: 'ribbon', interface: layoutId })
    document.querySelector('.intro p').textContent =
      'Learn your Ribbon tabs and group settings with illustrated guides and hands-on lessons for the Hillside access training project.'
    for (const link of document.querySelectorAll('.feature .actions a, .entry .links a')) {
      const [lesson, file] = link.getAttribute('href').split('/')
      link.href = ribbonUrl(lesson, file === 'tour.html' ? 'tour' : 'guide')
    }
  }
} else {
  const actions = document.querySelector('nav[aria-label="Lesson options"]')
  if (actions) {
    const topic = new URL('.', location.href).pathname.split('/').filter(Boolean).pop()
    const link = document.createElement('a')
    link.textContent = 'Use the Ribbon guide'
    link.href = ribbonUrl(topic, 'guide', '../')
    actions.append(link)
  }
}
