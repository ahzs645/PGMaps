import { createElement, useMemo, type ReactNode, type CSSProperties } from 'react'
import { readableStoryColor } from './readableStoryColor.js'

export function safeLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (/^(https?:\/\/|mailto:|#|\/(?!\/))/i.test(value)) return value
  return undefined
}

/** Original story markup is data; only a small formatting/link allowlist is rendered. */
export function SafeRichText({ html, onAction }: { html: string; onAction?: (id: string) => void }) {
  return useMemo(() => {
    const document = new DOMParser().parseFromString(html, 'text/html')
    const convert = (node: Node, key: string): ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent
      if (!(node instanceof Element)) return null
      const tag = node.tagName.toLowerCase()
      if (['script', 'style', 'iframe', 'object', 'embed'].includes(tag)) return null
      const children = Array.from(node.childNodes).map((child, index) => convert(child, `${key}-${index}`))
      if (node.getAttribute('data-action-type') === 'map-action') {
        const actionId = node.getAttribute('id')
        return (
          <button
            key={key}
            className="editorial-map-action"
            type="button"
            onClick={() => actionId && onAction?.(actionId)}
          >
            {children}
          </button>
        )
      }
      if (tag === 'a') {
        const href = safeLink(node.getAttribute('href'))
        return href ? (
          <a key={key} href={href} target={href.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer">
            {children}
          </a>
        ) : (
          <span key={key}>{children}</span>
        )
      }
      if (tag === 'span') {
        const color = /(?:^|\s)sm-text-color-([\da-f]{6})(?:\s|$)/i.exec(node.className)?.[1]
        return (
          <span
            key={key}
            className={color ? 'editorial-source-color' : undefined}
            style={
              color
                ? ({
                    '--editorial-source-color': `#${color}`,
                    '--editorial-readable-color': readableStoryColor(color),
                  } as CSSProperties)
                : undefined
            }
          >
            {children}
          </span>
        )
      }
      if (['strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'br', 'p', 'ul', 'ol', 'li'].includes(tag))
        return createElement(tag, { key }, children)
      return <span key={key}>{children}</span>
    }
    return <>{Array.from(document.body.childNodes).map((node, index) => convert(node, String(index)))}</>
  }, [html, onAction])
}
