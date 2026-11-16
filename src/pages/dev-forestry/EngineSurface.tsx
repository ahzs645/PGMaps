/**
 * Where another engine draws (`externalRenderers.ts`): a box its worker draws into (`startEngineWorker`), or a frame
 * holding its page on a site of its own (`separateSiteUrl`). Either way the bridge gets an `EngineChannel` through
 * `onConnect` once it is up, and null when it goes.
 */

import { useEffect, useLayoutEffect, useRef, type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { connectFrame, startEngineWorker, type EngineChannel, type EngineConnection } from './engineChannel'
import { engineKindOf, separateSiteUrl } from './externalRenderers'

type Props = {
  url: string
  title: string
  className?: string
  onConnect: (channel: EngineChannel | null) => void
} & Omit<HTMLAttributes<HTMLElement>, 'title' | 'className'>

export function EngineSurface({ url, title, className, onConnect, ...rest }: Props) {
  const kind = engineKindOf(url)
  // A page on a site of its own, so its long scripts (building a stand, a final capture) run in another process and
  // never freeze PGMaps' page (measured at 51-53 s a time on one shared main thread). A worker has its own thread.
  const address =
    kind === 'frame' ? separateSiteUrl(url, window.location.href).url : new URL(url, window.location.href).href
  const frameRef = useRef<HTMLIFrameElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const connectRef = useRef(onConnect)
  useLayoutEffect(() => {
    connectRef.current = onConnect
  })

  useEffect(() => {
    let connection: EngineConnection | null = null
    if (kind === 'worker' && boxRef.current) connection = startEngineWorker(address, boxRef.current, title)
    else if (kind === 'frame' && frameRef.current) connection = connectFrame(frameRef.current, new URL(address).origin)
    if (!connection) return
    connectRef.current(connection.channel)
    return () => {
      connectRef.current(null)
      connection.dispose()
    }
  }, [kind, address, title])

  return kind === 'worker' ? (
    <div
      ref={boxRef}
      role="img"
      aria-label={title}
      data-engine-kind="worker"
      className={cn('pointer-events-none relative overflow-hidden', className)}
      {...rest}
    />
  ) : (
    <iframe
      ref={frameRef}
      src={address}
      title={title}
      allow="webgpu"
      data-engine-kind="frame"
      className={cn('pointer-events-none border-0', className)}
      {...rest}
    />
  )
}
