'use strict'

// Serves the bundled web build to the app window from this computer only.
// Google sign-in accepts "localhost" as an authorised address, which a custom
// app:// scheme would not be, so the window loads http://localhost:<port>.

const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.gz': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
}

/** Resolves a request path to a file inside root, or null. Never leaves root. */
function resolveFile(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const target = path.resolve(root, '.' + path.posix.normalize('/' + decoded))
  if (target !== root && !target.startsWith(root + path.sep)) return null
  try {
    const stat = fs.statSync(target)
    if (stat.isFile()) return target
    if (stat.isDirectory()) {
      const index = path.join(target, 'index.html')
      if (fs.statSync(index).isFile()) return index
    }
  } catch {
    // Not found.
  }
  return null
}

/**
 * routes maps a path to a handler for requests the static files cannot answer
 * (the browser sign-in hand-off). Handlers see every method; files only GET and HEAD.
 */
function createStaticServer(rootDir, { routes = {} } = {}) {
  const root = path.resolve(rootDir)
  const fallback = path.join(root, 'index.html')
  let allowedHosts = new Set()

  const server = http.createServer((request, response) => {
    // Refuse other host names, so a web page cannot reach this server through DNS rebinding.
    if (!allowedHosts.has(request.headers.host ?? '')) {
      response.writeHead(421, { 'Content-Type': 'text/plain' }).end('Misdirected request')
      return
    }
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    if (Object.hasOwn(routes, pathname)) {
      routes[pathname](request, response)
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end()
      return
    }
    // Like the website's host, unknown paths get the single page, which shows its own "not found".
    const file = resolveFile(root, pathname) ?? fallback
    const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
    const headers = {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    }
    fs.stat(file, (error, stat) => {
      if (error) {
        response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
        return
      }
      response.writeHead(200, { ...headers, 'Content-Length': stat.size })
      if (request.method === 'HEAD') response.end()
      else fs.createReadStream(file).pipe(response)
    })
  })

  /** Listens on the first free port in the list; the window's address depends on it. */
  async function listen(ports) {
    for (const port of ports) {
      try {
        await new Promise((resolve, reject) => {
          server.once('error', reject)
          server.listen(port, '127.0.0.1', () => {
            server.off('error', reject)
            resolve()
          })
        })
        const actual = server.address().port
        allowedHosts = new Set([`localhost:${actual}`, `127.0.0.1:${actual}`])
        return actual
      } catch (error) {
        if (error.code !== 'EADDRINUSE') throw error
      }
    }
    throw new Error(`Ports ${ports.join(', ')} are all in use.`)
  }

  return { server, listen, close: () => new Promise((resolve) => server.close(resolve)) }
}

module.exports = { createStaticServer, resolveFile }
