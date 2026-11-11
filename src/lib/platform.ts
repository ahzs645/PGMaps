/** Apple devices name their modifier keys differently (⌘, ⌥); shortcut labels and handlers read this. */
export function isApplePlatform(nav: { platform?: string; userAgentData?: { platform?: string } } = navigator) {
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || '')
}
