/**
 * A small XML writer and a reader over `@xmldom/xmldom`, which parses without a browser DOM, so the
 * format modules run in unit tests and workers. The reader refuses DOCTYPE entity declarations and
 * oversized input before parsing. No DOM or network access.
 */
import { DOMParser, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom'

export type { XmlElement }

export const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // XML 1.0 has no way to write most control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')

export type Attributes = Record<string, string | number | boolean | null | undefined>

/** An element tree; `text` is escaped, `raw` is written as is (for CDATA). */
export interface XmlNodeSpec {
  name: string
  attrs?: Attributes
  children?: (XmlNodeSpec | null | false | undefined)[]
  text?: string
  raw?: string
}

export const el = (
  name: string,
  attrs?: Attributes,
  ...children: (XmlNodeSpec | null | false | undefined)[]
): XmlNodeSpec => ({
  name,
  attrs,
  children,
})
export const textEl = (name: string, text: string | number, attrs?: Attributes): XmlNodeSpec => ({
  name,
  attrs,
  text: String(text),
})

/** Trims a number to at most `digits` decimals without trailing zeros. */
export const num = (value: number, digits = 4) => {
  if (!Number.isFinite(value)) return '0'
  const rounded = Number(value.toFixed(digits))
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

function attributes(attrs?: Attributes) {
  if (!attrs) return ''
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ` ${key}="${escapeXml(typeof value === 'number' ? num(value, 6) : String(value))}"`)
    .join('')
}

/** Serialises a tree with two-space indentation. */
export function writeXml(node: XmlNodeSpec, indent = ''): string {
  const children = (node.children ?? []).filter((child): child is XmlNodeSpec => Boolean(child))
  const open = `${indent}<${node.name}${attributes(node.attrs)}`
  if (node.raw !== undefined) return `${open}>${node.raw}</${node.name}>`
  if (node.text !== undefined) return `${open}>${escapeXml(node.text)}</${node.name}>`
  if (!children.length) return `${open}/>`
  return `${open}>\n${children.map((child) => writeXml(child, indent + '  ')).join('\n')}\n${indent}</${node.name}>`
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>'

/** Largest XML file a reader accepts. */
export const MAX_XML_BYTES = 16 * 1024 * 1024

/** Parses XML, or throws an Error naming the problem. */
export function parseXml(text: string): XmlElement {
  if (text.length > MAX_XML_BYTES) throw Error(`The file is larger than ${MAX_XML_BYTES / 1024 / 1024} MB.`)
  if (/<!ENTITY/i.test(text)) throw Error('The file declares XML entities, which are not read.')
  const errors: string[] = []
  let root: XmlElement | null = null
  try {
    root = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') errors.push(message)
      },
    }).parseFromString(text, 'text/xml').documentElement
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  if (errors.length || !root) throw Error(`The file is not well-formed XML: ${errors[0] ?? 'no root element'}.`)
  return root
}

const ELEMENT_NODE = 1
/** Name without its namespace prefix. */
export const localName = (node: XmlNode) => (node as XmlElement).localName ?? node.nodeName.replace(/^.*:/, '')

/** Child elements, optionally only those with a local name. */
export function childElements(parent: XmlElement, name?: string): XmlElement[] {
  const out: XmlElement[] = []
  for (let child = parent.firstChild; child; child = child.nextSibling)
    if (child.nodeType === ELEMENT_NODE && (!name || localName(child) === name)) out.push(child as XmlElement)
  return out
}
export const child = (parent: XmlElement, name: string): XmlElement | undefined => childElements(parent, name)[0]

/** First descendant at a path of local names: `path(root, 'renderer-v2', 'symbols')`. */
export function path(parent: XmlElement | undefined, ...names: string[]): XmlElement | undefined {
  let node = parent
  for (const name of names) node = node && child(node, name)
  return node
}

/** Every descendant with a local name, document order. */
export function descendants(parent: XmlElement, name: string): XmlElement[] {
  const out: XmlElement[] = []
  const walk = (node: XmlElement) => {
    for (const element of childElements(node)) {
      if (localName(element) === name) out.push(element)
      walk(element)
    }
  }
  walk(parent)
  return out
}

export const textOf = (element: XmlElement | undefined) => (element?.textContent ?? '').trim()
export const attr = (element: XmlElement | undefined, name: string) => element?.getAttribute(name) ?? null
