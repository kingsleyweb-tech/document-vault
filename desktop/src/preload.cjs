'use strict'

// Runs sandboxed before the page. It exposes a small, fixed set of calls and
// never hands the page ipcRenderer or any Node.js API. The main process also
// checks that each call comes from the app's own page.

const { contextBridge, ipcRenderer } = require('electron')

const info = ipcRenderer.sendSync('dv:info') ?? {}

contextBridge.exposeInMainWorld('documentVaultDesktop', {
  isDesktop: true,
  version: String(info.version ?? ''),
  platform: String(info.platform ?? ''),
  companionPort: typeof info.companionPort === 'number' ? info.companionPort : null,
  requestPairingCode: () => ipcRenderer.invoke('dv:pairing-code'),
  checkForUpdates: () => ipcRenderer.invoke('dv:check-updates'),
  // Opens Google sign-in in the user's browser and resolves with the Google tokens.
  signInWithGoogle: (options) =>
    ipcRenderer.invoke('dv:google-sign-in', {
      mode: options?.mode === 'reauthorize' ? 'reauthorize' : 'login',
      hint: typeof options?.hint === 'string' ? options.hint : '',
    }),
  cancelGoogleSignIn: () => ipcRenderer.invoke('dv:cancel-google-sign-in'),
  // The in-app web browser. Requests are plain objects; the main process checks every field.
  web: {
    request: (request) => ipcRenderer.invoke('dv:web', request),
    onState: (listener) => subscribe('dv:web:state', listener),
    onNotice: (listener) => subscribe('dv:web:notice', listener),
    onCheck: (listener) => subscribe('dv:web:check', listener),
  },
})

/** Passes only the message to the page, never the IPC event, and returns a way to stop listening. */
function subscribe(channel, listener) {
  const handler = (_event, payload) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}
