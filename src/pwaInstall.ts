// Chrome and Edge fire `beforeinstallprompt` once, early, and only when the
// site can be installed. It is kept here so the Downloads page can offer an
// Install button later; other browsers never fire it and show instructions.

export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as InstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    notify()
  })
}

export function canPromptInstall() {
  return deferred !== null
}

export function isRunningInstalled() {
  if (typeof window === 'undefined') return false
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return Boolean(standalone || iosStandalone)
}

export async function promptInstall() {
  const event = deferred
  if (!event) return 'unavailable' as const
  deferred = null
  notify()
  await event.prompt()
  const choice = await event.userChoice
  return choice.outcome
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
