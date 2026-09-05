import { useEffect, useRef, useState } from 'react'

export function useCopyText() {
  const [message, setMessage] = useState('')
  const timeout = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timeout.current), [])
  const copy = async (text: string) => {
    clearTimeout(timeout.current)
    try {
      await navigator.clipboard.writeText(text)
      setMessage('Copied to clipboard.')
      timeout.current = setTimeout(() => setMessage(''), 3000)
    } catch {
      setMessage('Copy was unavailable. Select the draft text and use your device’s Copy command.')
    }
  }
  return { copy, message }
}
