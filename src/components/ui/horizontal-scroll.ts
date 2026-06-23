type HorizontalWheelEvent = {
  currentTarget: HTMLElement
  deltaX: number
  deltaY: number
  preventDefault: () => void
}

export function handleHorizontalWheelScroll(event: HorizontalWheelEvent) {
  const element = event.currentTarget
  const maxScrollLeft = element.scrollWidth - element.clientWidth

  if (maxScrollLeft <= 0) return

  const delta =
    Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
  if (delta === 0) return

  const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft + delta))
  if (nextScrollLeft === element.scrollLeft) return

  event.preventDefault()
  element.scrollLeft = nextScrollLeft
}
