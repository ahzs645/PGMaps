export function AccessLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={compact ? 'access-lockup access-lockup-compact' : 'access-lockup'}
      role="img"
      aria-label="DDC Access"
    >
      <span>Access</span>
    </span>
  )
}
