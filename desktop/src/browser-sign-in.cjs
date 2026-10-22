'use strict'

// Google refuses to sign in inside an app's own window, so the app opens its
// sign-in page in the user's browser instead. That page is served by this
// app's local server (http://localhost:<port>/desktop-sign-in), signs in with
// Google there, and posts the Google tokens back to the same local server.
// A one-time code in the address ties the answer to the request that opened
// it, so nothing else on the computer can hand the app a sign-in.

const crypto = require('node:crypto')

const PAGE_PATH = '/desktop-sign-in'
const COMPLETE_PATH = '/desktop-sign-in/complete'
const MAX_BODY_BYTES = 16 * 1024
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

class SignInCancelled extends Error {
  constructor(message) {
    super(message)
    this.code = 'desktop/sign-in-cancelled'
  }
}

/**
 * origin(): the local server's address, for example http://localhost:47616.
 * openBrowser(url): opens the address in the user's browser.
 * onComplete(): called after a successful hand-off, to bring the app forward.
 */
function createBrowserSignIn({ origin, openBrowser, onComplete = () => {}, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  let pending = null

  function settle(error, value) {
    if (!pending) return
    const { resolve, reject, timer } = pending
    pending = null
    clearTimeout(timer)
    if (error) reject(error)
    else resolve(value)
  }

  /** Opens sign-in in the browser; resolves with { idToken, accessToken }. */
  async function start({ mode = 'login', hint = '' } = {}) {
    // Only one sign-in at a time: a second click replaces the first.
    settle(new SignInCancelled('A newer sign-in was started.'))
    const state = crypto.randomBytes(32).toString('base64url')
    const url = new URL(PAGE_PATH, origin())
    url.searchParams.set('state', state)
    url.searchParams.set('mode', mode === 'reauthorize' ? 'reauthorize' : 'login')
    if (typeof hint === 'string' && hint.length > 0 && hint.length <= 320) url.searchParams.set('hint', hint)

    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(new SignInCancelled('Sign-in took too long. Try again.')), timeoutMs)
      pending = { state, resolve, reject, timer }
    })
    try {
      await openBrowser(url.href)
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
    }
    return result
  }

  function cancel() {
    settle(new SignInCancelled('Sign-in was cancelled.'))
  }

  function reply(response, status, message) {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(message)
  }

  /** Handles POST /desktop-sign-in/complete from the page in the browser. */
  function handleComplete(request, response) {
    if (request.method !== 'POST') return reply(response, 405, 'Method not allowed')
    // Browsers always send Origin on a POST; only the app's own page may answer.
    if (request.headers.origin !== origin()) return reply(response, 403, 'Forbidden')
    if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) return reply(response, 415, 'Expected JSON')

    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reply(response, 413, 'Too large')
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (response.writableEnded) return
      let body
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return reply(response, 400, 'Bad request')
      }
      const { state, idToken, accessToken } = body ?? {}
      if (!pending || !sameCode(state, pending.state)) {
        return reply(response, 409, 'This sign-in is no longer waiting. Start again from the Document Vault app.')
      }
      if (typeof idToken !== 'string' || typeof accessToken !== 'string' || !idToken || !accessToken) {
        return reply(response, 400, 'Bad request')
      }
      settle(null, { idToken, accessToken })
      reply(response, 200, 'Signed in')
      onComplete()
    })
  }

  return { start, cancel, handleComplete, routes: { [COMPLETE_PATH]: handleComplete } }
}

function sameCode(given, expected) {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

module.exports = { createBrowserSignIn, PAGE_PATH, COMPLETE_PATH }
