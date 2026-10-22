import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { legacyHashTarget } from './routing'
import { Root } from './Root'
import './pwaInstall'

// Apply the saved theme before the first paint so there is no flash of the wrong colours.
try {
  document.documentElement.dataset.theme = localStorage.getItem('documentVault.theme') === 'dark' ? 'dark' : 'light'
} catch {
  document.documentElement.dataset.theme = 'light'
}

const legacyTarget = legacyHashTarget(window.location.hash)
if (legacyTarget) window.history.replaceState(null, '', legacyTarget)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root pathname={window.location.pathname} />
  </StrictMode>,
)

// The desktop app's browser sign-in page runs on the app's local address in the
// user's own browser; it must not leave a service worker behind there.
const desktopSignInPage = window.location.pathname === '/desktop-sign-in'

if ('serviceWorker' in navigator && import.meta.env.PROD && !desktopSignInPage) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
} else if ('serviceWorker' in navigator && !desktopSignInPage) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister()
      })
    })
  })
}
