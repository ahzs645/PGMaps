import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
  type MutableRefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { getSnapPositions, resolveSnap, stateFromTranslate, type MobileSheetState } from './sheet-math.js'

interface SheetGestureOptions {
  sheetRef: RefObject<HTMLDivElement | null>
  handleRef: RefObject<HTMLDivElement | null>
  draggingRef: MutableRefObject<boolean>
  translateRef: MutableRefObject<number>
  mobileFeatureCardOpen: boolean
  mobileControlsInFront: boolean
  bringControlsToFront: () => void
  applyTransform: (y: number, animate: boolean) => void
  getFullSnapOffset: () => number
  getSheetHeight: () => number
  mobileCollapsedVisibleHeight: number
  snapTo: (state: MobileSheetState) => void
  mobileSheetState: MobileSheetState
  isMobile: boolean
}
/** Touch-scroll arbitration, pointer velocity and accessible keyboard snapping. */
export function useMobileSheetGestures({
  sheetRef,
  handleRef,
  draggingRef,
  translateRef,
  mobileFeatureCardOpen,
  mobileControlsInFront,
  bringControlsToFront,
  applyTransform,
  getFullSnapOffset,
  getSheetHeight,
  mobileCollapsedVisibleHeight,
  snapTo,
  mobileSheetState,
  isMobile,
}: SheetGestureOptions) {
  const startY = useRef(0)
  const startX = useRef(0)
  const startTranslate = useRef(0)
  const prevTouchY = useRef(0)
  const prevTouchTime = useRef(0)
  const vel = useRef(0)
  const fromHandle = useRef(false)
  const decided = useRef(false)
  const pointerDragId = useRef<number | null>(null)

  // ------ touch events (non-passive, native) --------------------------------

  useEffect(() => {
    const sheet = sheetRef.current
    const handle = handleRef.current
    if (!sheet || !handle) return

    /** Walk up from target to find the first scrollable ancestor inside sheet. */
    function findScrollable(el: HTMLElement | null): HTMLElement | null {
      while (el && el !== sheet) {
        if (el.scrollHeight > el.clientHeight + 1) {
          const ov = getComputedStyle(el).overflowY
          if (ov === 'auto' || ov === 'scroll') return el
        }
        el = el.parentElement
      }
      return null
    }

    function onTouchStart(e: TouchEvent) {
      if (!isMobile) return
      if ((e.target as HTMLElement | null)?.closest('[data-map-mobile-sheet-peek-action="true"]')) return
      const t = e.touches[0]
      const isHandle = handle!.contains(e.target as Node)
      if (isHandle && mobileFeatureCardOpen && !mobileControlsInFront) {
        bringControlsToFront()
      }

      startY.current = t.clientY
      startX.current = t.clientX
      startTranslate.current = translateRef.current
      prevTouchY.current = t.clientY
      prevTouchTime.current = performance.now()
      vel.current = 0
      fromHandle.current = isHandle
      decided.current = false

      if (isHandle) {
        draggingRef.current = true
        decided.current = true
        sheet!.style.transition = 'none'
        sheet!.style.willChange = 'transform'
        e.preventDefault()
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (!isMobile) return
      const t = e.touches[0]
      const now = performance.now()
      const dt = now - prevTouchTime.current
      if (dt > 0) vel.current = (t.clientY - prevTouchY.current) / dt
      prevTouchY.current = t.clientY
      prevTouchTime.current = now

      // Already draggingRef — update position
      if (draggingRef.current) {
        e.preventDefault()
        const delta = t.clientY - startY.current
        let ny = startTranslate.current + delta
        const snaps = getSnapPositions(getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)
        // Rubber-band at edges
        if (ny < snaps.full) ny = snaps.full - (snaps.full - ny) * 0.25
        if (ny > snaps.collapsed) ny = snaps.collapsed + (ny - snaps.collapsed) * 0.25
        applyTransform(ny, false)
        return
      }

      // Direction decision for content touches
      if (!decided.current) {
        const dx = Math.abs(t.clientX - startX.current)
        const dy = Math.abs(t.clientY - startY.current)
        if (dx + dy < 10) return // too small to decide

        decided.current = true
        if (dx > dy) return // horizontal — let browser handle

        const state = stateFromTranslate(
          translateRef.current,
          getSheetHeight(),
          getFullSnapOffset(),
          mobileCollapsedVisibleHeight,
        )
        const goingDown = t.clientY > startY.current

        if (state !== 'full') {
          // Sheet not fully open — vertical always drags
          draggingRef.current = true
          startY.current = t.clientY
          startTranslate.current = translateRef.current
          sheet!.style.transition = 'none'
          sheet!.style.willChange = 'transform'
          e.preventDefault()
          return
        }

        // Full state: only drag if pulling down from scroll-top
        if (goingDown) {
          const sc = findScrollable(e.target as HTMLElement)
          if (!sc || sc.scrollTop <= 0) {
            draggingRef.current = true
            startY.current = t.clientY
            startTranslate.current = translateRef.current
            sheet!.style.transition = 'none'
            sheet!.style.willChange = 'transform'
            e.preventDefault()
          }
        }
        // else: let content scroll naturally
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (!isMobile) return
      sheet!.style.willChange = ''

      if (!draggingRef.current) return
      draggingRef.current = false

      // Tap on handle (< 10 px total movement) → cycle state
      if (fromHandle.current && e.changedTouches.length > 0) {
        const ct = e.changedTouches[0]
        const moved = Math.abs(ct.clientY - startY.current) + Math.abs(ct.clientX - startX.current)
        if (moved < 10) {
          if (mobileFeatureCardOpen && !mobileControlsInFront) {
            bringControlsToFront()
            return
          }
          const s = stateFromTranslate(
            translateRef.current,
            getSheetHeight(),
            getFullSnapOffset(),
            mobileCollapsedVisibleHeight,
          )
          snapTo(s === 'collapsed' ? 'half' : s === 'half' ? 'full' : 'collapsed')
          return
        }
      }

      snapTo(
        resolveSnap(
          translateRef.current,
          vel.current,
          getSheetHeight(),
          getFullSnapOffset(),
          mobileCollapsedVisibleHeight,
        ),
      )
    }

    sheet.addEventListener('touchstart', onTouchStart, { passive: false })
    sheet.addEventListener('touchmove', onTouchMove, { passive: false })
    sheet.addEventListener('touchend', onTouchEnd)
    sheet.addEventListener('touchcancel', onTouchEnd)

    return () => {
      sheet.removeEventListener('touchstart', onTouchStart)
      sheet.removeEventListener('touchmove', onTouchMove)
      sheet.removeEventListener('touchend', onTouchEnd)
      sheet.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [
    applyTransform,
    bringControlsToFront,
    getFullSnapOffset,
    getSheetHeight,
    mobileCollapsedVisibleHeight,
    mobileControlsInFront,
    mobileFeatureCardOpen,
    snapTo,
    draggingRef,
    handleRef,
    isMobile,
    sheetRef,
    translateRef,
  ])

  // Scrim tap → collapse
  const handleScrimClick = useCallback(() => snapTo('collapsed'), [snapTo])

  const startHandlePointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isMobile || event.pointerType === 'touch') return
      if (mobileFeatureCardOpen && !mobileControlsInFront) {
        bringControlsToFront()
      }

      pointerDragId.current = event.pointerId
      draggingRef.current = true
      fromHandle.current = true
      decided.current = true
      startY.current = event.clientY
      startX.current = event.clientX
      startTranslate.current = translateRef.current
      prevTouchY.current = event.clientY
      prevTouchTime.current = performance.now()
      vel.current = 0
      sheetRef.current?.style.setProperty('transition', 'none')
      sheetRef.current?.style.setProperty('will-change', 'transform')
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [bringControlsToFront, mobileControlsInFront, mobileFeatureCardOpen, draggingRef, isMobile, sheetRef, translateRef],
  )

  const moveHandlePointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isMobile || event.pointerId !== pointerDragId.current || !draggingRef.current) return

      const now = performance.now()
      const dt = now - prevTouchTime.current
      if (dt > 0) vel.current = (event.clientY - prevTouchY.current) / dt
      prevTouchY.current = event.clientY
      prevTouchTime.current = now

      const delta = event.clientY - startY.current
      let nextY = startTranslate.current + delta
      const snaps = getSnapPositions(getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)
      if (nextY < snaps.full) nextY = snaps.full - (snaps.full - nextY) * 0.25
      if (nextY > snaps.collapsed) nextY = snaps.collapsed + (nextY - snaps.collapsed) * 0.25
      applyTransform(nextY, false)
      event.preventDefault()
    },
    [applyTransform, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, draggingRef, isMobile],
  )

  const endHandlePointerDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== pointerDragId.current) return

      pointerDragId.current = null
      sheetRef.current?.style.setProperty('will-change', '')
      if (!draggingRef.current) return
      draggingRef.current = false

      const moved = Math.abs(event.clientY - startY.current) + Math.abs(event.clientX - startX.current)
      if (moved < 10) {
        const state = stateFromTranslate(
          translateRef.current,
          getSheetHeight(),
          getFullSnapOffset(),
          mobileCollapsedVisibleHeight,
        )
        snapTo(state === 'collapsed' ? 'half' : state === 'half' ? 'full' : 'collapsed')
        return
      }

      snapTo(
        resolveSnap(
          translateRef.current,
          vel.current,
          getSheetHeight(),
          getFullSnapOffset(),
          mobileCollapsedVisibleHeight,
        ),
      )
    },
    [getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, snapTo, draggingRef, sheetRef, translateRef],
  )

  const handleMobileSheetKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return
      const states: MobileSheetState[] = ['collapsed', 'half', 'full']
      const currentIndex = states.indexOf(mobileSheetState)
      let nextState: MobileSheetState | undefined

      if (event.key === 'ArrowUp') nextState = states[Math.min(states.length - 1, currentIndex + 1)]
      if (event.key === 'ArrowDown') nextState = states[Math.max(0, currentIndex - 1)]
      if (event.key === 'Home') nextState = 'collapsed'
      if (event.key === 'End') nextState = 'full'
      if (event.key === 'Enter' || event.key === ' ') {
        nextState = mobileSheetState === 'collapsed' ? 'half' : mobileSheetState === 'half' ? 'full' : 'collapsed'
      }
      if (!nextState) return

      event.preventDefault()
      snapTo(nextState)
    },
    [mobileSheetState, snapTo],
  )

  return {
    handleScrimClick,
    handleMobileSheetKeyDown,
    startHandlePointerDrag,
    moveHandlePointerDrag,
    endHandlePointerDrag,
  }
}
