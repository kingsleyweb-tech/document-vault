'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { createStaticServer } = require('../src/static-server.cjs')
const { findUpdate, isNewer } = require('../src/updates.cjs')

test('serves files, falls back to the page, and refuses other hosts and traversal', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-web-'))
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>page')
  fs.mkdirSync(path.join(root, 'assets'))
  fs.writeFileSync(path.join(root, 'assets', 'a.js'), 'console.log(1)')
  fs.writeFileSync(path.join(os.tmpdir(), 'dv-secret.txt'), 'secret')
  const server = createStaticServer(root)
  const port = await server.listen([0])
  const actual = server.server.address().port
  const get = (route, host = `localhost:${actual}`) =>
    new Promise((resolve, reject) => {
      require('node:http')
        .get({ host: '127.0.0.1', port: actual, path: route, headers: { host } }, (response) => {
          let body = ''
          response.on('data', (chunk) => (body += chunk))
          response.on('end', () => resolve({ status: response.statusCode, type: response.headers['content-type'], body }))
        })
        .on('error', reject)
    })
  try {
    assert.equal(port, actual)
    const asset = await get('/assets/a.js')
    assert.equal(asset.status, 200)
    assert.match(asset.type, /javascript/)
    assert.equal((await get('/app/folders/1')).body, '<!doctype html>page')
    assert.equal((await get('/../dv-secret.txt')).body, '<!doctype html>page')
    assert.equal((await get('/%2e%2e/dv-secret.txt')).body, '<!doctype html>page')
    assert.equal((await get('/', 'evil.example:80')).status, 421)
  } finally {
    await server.close()
  }
})

test('offers an update only when a newer build for this system is published', () => {
  const manifest = {
    schemaVersion: 1,
    version: '1.2.0',
    builds: [
      { platform: 'windows', arch: 'x64', available: true, url: 'https://example.com/a.exe' },
      { platform: 'macos', arch: 'arm64', available: false, url: null },
    ],
  }
  assert.equal(isNewer('1.10.0', '1.9.9'), true)
  assert.equal(isNewer('1.0.0', '1.0.0'), false)
  assert.equal(findUpdate(manifest, { version: '1.0.0', platform: 'win32', arch: 'x64' })?.version, '1.2.0')
  assert.equal(findUpdate(manifest, { version: '1.2.0', platform: 'win32', arch: 'x64' }), null)
  assert.equal(findUpdate(manifest, { version: '1.0.0', platform: 'darwin', arch: 'arm64' }), null)
  assert.equal(findUpdate(null, { version: '1.0.0', platform: 'win32', arch: 'x64' }), null)
})

test('the app window gets an enforced Content Security Policy naming the companion port', async () => {
  const { contentSecurityPolicy } = require('../src/static-server.cjs')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-web-'))
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>page')
  let companionPort = 47615
  const server = createStaticServer(root, { csp: () => contentSecurityPolicy({ companionPort }) })
  const port = await server.listen([0])
  const headers = () =>
    new Promise((resolve, reject) => {
      require('node:http')
        .get({ host: '127.0.0.1', port, path: '/app', headers: { host: `localhost:${port}` } }, (response) => {
          response.resume()
          resolve(response.headers)
        })
        .on('error', reject)
    })
  try {
    const first = (await headers())['content-security-policy']
    assert.match(first, /connect-src [^;]*http:\/\/127\.0\.0\.1:47615/)
    assert.match(first, /object-src 'none'/)
    assert.match(first, /frame-ancestors 'none'/)
    assert.doesNotMatch(first, /'unsafe-eval'/)
    assert.doesNotMatch(first, /script-src [^;]*'unsafe-inline'/)
    // The companion took another port: the policy follows it.
    companionPort = 51234
    const second = (await headers())['content-security-policy']
    assert.match(second, /http:\/\/127\.0\.0\.1:51234/)
    assert.doesNotMatch(second, /47615/)
  } finally {
    await server.close()
  }
})

test('development servers may call the companion only from development builds', () => {
  const { companionOrigins } = require('../src/origins.cjs')
  const development = ['http://localhost:5173']
  const site = 'https://documents-vault.vercel.app'
  assert.deepEqual(companionOrigins('http://localhost:47616', { site, packaged: true, development }), ['http://localhost:47616', site])
  assert.deepEqual(companionOrigins('http://localhost:47616', { site, packaged: false, development }), ['http://localhost:47616', site, 'http://localhost:5173'])
})
