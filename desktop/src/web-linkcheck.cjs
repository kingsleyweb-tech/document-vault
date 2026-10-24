'use strict'

const { parseWebUrl } = require('./web-urls.cjs')

// Checks saved references, only when the person asks. Each address is fetched
// from its own session without cookies, every redirect is checked against the
// same rules as the browser, and nothing about the library is sent.

const TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5
const CONCURRENCY = 4

async function checkOne(fetcher, url, rules) {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!parseWebUrl(current, rules)) return { status: 'blocked', code: null, finalUrl: current, detail: 'It redirects to an address the browser does not open.' }
    let response
    try {
      response = await request(fetcher, current, 'HEAD')
      // Some servers do not answer HEAD requests properly; ask for the page itself.
      if ([403, 405, 501].includes(response.status)) response = await request(fetcher, current, 'GET')
    } catch (error) {
      const timedOut = error?.name === 'AbortError' || error?.name === 'TimeoutError'
      return { status: 'unreachable', code: null, finalUrl: current, detail: timedOut ? 'The site did not respond in time.' : 'The site could not be reached.' }
    }
    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      try {
        current = new URL(location, current).href
      } catch {
        return { status: 'broken', code: response.status, finalUrl: current, detail: 'The site redirects to an invalid address.' }
      }
      continue
    }
    if (response.ok) return { status: current === url ? 'ok' : 'redirected', code: response.status, finalUrl: current, detail: null }
    if (response.status === 404 || response.status === 410) return { status: 'broken', code: response.status, finalUrl: current, detail: 'The page no longer exists.' }
    return { status: 'problem', code: response.status, finalUrl: current, detail: `The site answered with status ${response.status}.` }
  }
  return { status: 'broken', code: null, finalUrl: current, detail: 'The address redirects too many times.' }
}

async function request(fetcher, url, method) {
  const response = await fetcher(url, { method, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store', credentials: 'omit' })
  // Only the status matters; do not download the page.
  response.body?.cancel?.().catch?.(() => {})
  return response
}

/** Checks each { id, url }; calls onResult(id, result) as each finishes. */
async function checkLinks(fetcher, items, onResult, rules = {}) {
  const queue = [...items]
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const result = await checkOne(fetcher, item.url, rules)
      onResult(item.id, { ...result, checkedAt: Date.now() })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))
}

module.exports = { checkLinks, checkOne }
