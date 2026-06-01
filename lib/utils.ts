export function cn(...classes: (string | string[] | undefined | null | false)[]): string {
  return classes.flat().filter(Boolean).join(' ')
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function timeUntil(date: Date | string): string {
  const ms = new Date(date).getTime() - Date.now()
  if (ms <= 0) return 'Expired'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
