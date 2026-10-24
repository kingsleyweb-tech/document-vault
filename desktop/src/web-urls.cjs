'use strict'

// Address rules for the in-app web browser. The main process applies them to
// every navigation, redirect, pop-up and request, so they are the final word;
// the page only uses them to explain itself sooner.

const SEARCH_URL = 'https://duckduckgo.com/?q='
const MAX_URL_LENGTH = 8192

/** Hosts that reach this computer: Document Vault's own services live there. */
function isLoopbackHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1' || host === '::' || host === '0.0.0.0') return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  // IPv4 written inside IPv6 (::ffff:127.0.0.1 is shown as ::ffff:7f00:1).
  if (/^::ffff:(127\.|7f[0-9a-f]{2}:)/.test(host)) return true
  // Whole-number and hexadecimal spellings of 127.x are normalised by URL already;
  // 0.x addresses can also reach this computer on some systems.
  if (/^0\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true
  return false
}

/**
 * The address as a URL when the browser may open it as a page: http or https,
 * no user name or password in it, and not this computer. Otherwise null.
 */
function parseWebUrl(value, { allowLoopback = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_URL_LENGTH) return null
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // user:password@ addresses are used to disguise where a link really goes.
  if (url.username || url.password) return null
  if (!url.hostname) return null
  if (!allowLoopback && isLoopbackHost(url.hostname)) return null
  return url
}

/** Why an address is refused, in words for the person using the app. */
function refusalReason(value, options) {
  if (typeof value !== 'string' || value.trim() === '') return 'There is no address to open.'
  let url
  try {
    url = new URL(value)
  } catch {
    return 'This is not a valid web address.'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return `Addresses starting with “${url.protocol}” cannot be opened in Document Vault's browser. Only http and https web pages can.`
  }
  if (url.username || url.password) return 'Addresses containing a user name or password are not opened, because they are often used to disguise where a link goes.'
  if (!(options?.allowLoopback) && isLoopbackHost(url.hostname)) {
    return 'Addresses on this computer (such as localhost) are not opened in the browser, so websites cannot reach Document Vault or your library.'
  }
  if (value.length > MAX_URL_LENGTH) return 'This address is too long.'
  return parseWebUrl(value, options) ? null : 'This address cannot be opened.'
}

/**
 * Turns what was typed in the address bar into a URL to open:
 * { url } for an address or a search, or { error } for something refused.
 */
function addressFromInput(input, options) {
  const text = String(input ?? '').trim()
  if (!text) return { error: 'Type a web address or words to search for.' }
  const hostAndPort = /^[^\s/:?#]+:\d{1,5}([/?#]|$)/.test(text)
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !hostAndPort) {
    // An explicit scheme: only http and https are accepted.
    const url = parseWebUrl(text, options)
    return url ? { url: url.href } : { error: refusalReason(text, options) }
  }
  const looksLikeAddress = !/\s/.test(text) && (hostAndPort || /^[^/?#]+\.[^/?#.]{2,}([/?#]|$)/.test(text))
  if (looksLikeAddress) {
    const url = parseWebUrl(`https://${text}`, options)
    return url ? { url: url.href } : { error: refusalReason(`https://${text}`, options) }
  }
  return { url: SEARCH_URL + encodeURIComponent(text) }
}

/** Schemes a page may load parts of itself from (images, styles, scripts, connections). */
function isAllowedRequest(value, { allowLoopback = false } = {}) {
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  switch (url.protocol) {
    case 'http:':
    case 'https:':
    case 'ws:':
    case 'wss:':
      return allowLoopback || !isLoopbackHost(url.hostname)
    case 'data:':
    case 'blob:':
      return true
    default:
      return false
  }
}

/** Frames inside a page may also show blank and inline documents. */
function isAllowedFrameUrl(value, options) {
  if (value === 'about:blank' || value === 'about:srcdoc') return true
  if (/^(data|blob):/i.test(value)) return true
  return parseWebUrl(value, options) !== null
}

const TRACKING_PARAMETER = /^(utm_[a-z]+|fbclid|gclid|mc_eid|mc_cid)$/i

/** The same page written differently gets the same key, for finding duplicate saved references. */
function urlKey(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return String(value)
  }
  url.hash = ''
  for (const name of [...url.searchParams.keys()]) if (TRACKING_PARAMETER.test(name)) url.searchParams.delete(name)
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const pathname = url.pathname.replace(/\/+$/, '') || '/'
  const search = url.searchParams.toString()
  // http and https copies of a page count as the same reference.
  return `${host}${url.port ? `:${url.port}` : ''}${pathname}${search ? `?${search}` : ''}`
}

module.exports = { SEARCH_URL, addressFromInput, isAllowedFrameUrl, isAllowedRequest, isLoopbackHost, parseWebUrl, refusalReason, urlKey }
