/** JSON integers outside JavaScript's exact range remain decimal strings. */
export function parseImportJson(text: string): unknown {
  let quoted = false
  let escaped = false
  let output = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      output += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') {
      quoted = true
      output += char
    } else if (char === '-' || /\d/.test(char)) {
      const match = text.slice(index).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)
      if (!match) {
        output += char
        continue
      }
      const token = match[0]
      const numeric = Number(token)
      if (!Number.isFinite(numeric)) throw new Error('A JSON number is outside the supported finite range.')
      output += /^-?\d+$/.test(token) && !Number.isSafeInteger(numeric) ? JSON.stringify(token) : token
      index += token.length - 1
    } else output += char
  }
  return JSON.parse(output)
}

export async function sha256Bytes(value: Blob | Uint8Array): Promise<string> {
  const bytes = value instanceof Blob ? await value.arrayBuffer() : new Uint8Array(value).buffer
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function importFilename(name: string, fallback = 'attachment.bin'): string {
  const clean = name
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.split('')
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join('')
    .trim()
  return clean?.slice(0, 180) || fallback
}
