/**
 * The name a file is kept under in a project (`projectArchive.ts`): characters a file system refuses become "-",
 * leading and trailing dots go, and it is cut to 200 characters. No DOM or network access.
 */
export function projectAttachmentName(name: string) {
  return (
    Array.from(name.replace(/[<>:"/\\|?*]/g, '-'), (char) => (char.charCodeAt(0) < 32 ? '-' : char))
      .join('')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 200) || 'attachment'
  )
}
