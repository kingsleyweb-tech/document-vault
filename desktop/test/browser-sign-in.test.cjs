'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { createBrowserSignIn } = require('../src/browser-sign-in.cjs')
const { createStaticServer } = require('../src/static-server.cjs')

async function setUp({ timeoutMs } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-web-'))
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html>page')
  let origin = null
  const opened = []
  let completed = 0
  const signIn = createBrowserSignIn({
    origin: () => origin,
    openBrowser: async (url) => void opened.push(new URL(url)),
    onComplete: () => completed++,
    timeoutMs,
  })
  const server = createStaticServer(root, { routes: signIn.routes })
  const port = await server.listen([0])
  origin = `http://localhost:${port}`

  const post = (body, { from = origin, type = 'application/json' } = {}) =>
    new Promise((resolve, reject) => {
      const data = typeof body === 'string' ? body : JSON.stringify(body)
      const request = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/desktop-sign-in/complete',
          method: 'POST',
          headers: { host: `localhost:${port}`, origin: from, 'content-type': type, 'content-length': Buffer.byteLength(data) },
        },
        (response) => {
          response.resume()
          response.on('end', () => resolve(response.statusCode))
        },
      )
      request.on('error', reject)
      request.end(data)
    })

  return { signIn, server, origin, opened, post, completed: () => completed }
}

const tokens = { idToken: 'id-token', accessToken: 'access-token' }

test('opens the sign-in page on the local server and accepts the matching answer once', async () => {
  const { signIn, server, origin, opened, post, completed } = await setUp()
  try {
    const result = signIn.start({ mode: 'reauthorize', hint: 'person@example.com' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(opened.length, 1)
    const url = opened[0]
    assert.equal(url.origin, origin)
    assert.equal(url.pathname, '/desktop-sign-in')
    assert.equal(url.searchParams.get('mode'), 'reauthorize')
    assert.equal(url.searchParams.get('hint'), 'person@example.com')
    const state = url.searchParams.get('state')
    assert.ok(state && state.length >= 40)

    assert.equal(await post({ state: 'wrong', ...tokens }), 409)
    assert.equal(await post({ state, ...tokens }, { from: 'https://evil.example' }), 403)
    assert.equal(await post({ state, ...tokens }, { type: 'text/plain' }), 415)
    assert.equal(await post({ state, idToken: '', accessToken: 'x' }), 400)
    assert.equal(await post('not json'), 400)

    assert.equal(await post({ state, ...tokens }), 200)
    assert.deepEqual(await result, tokens)
    assert.equal(completed(), 1)
    // The code works once.
    assert.equal(await post({ state, ...tokens }), 409)
  } finally {
    await server.close()
  }
})

test('a new sign-in replaces the old one, and cancel and time-outs end the wait', async () => {
  const { signIn, server, opened, post } = await setUp({ timeoutMs: 50 })
  try {
    const first = signIn.start()
    const second = signIn.start()
    await assert.rejects(first, { code: 'desktop/sign-in-cancelled' })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(await post({ state: opened[0].searchParams.get('state'), ...tokens }), 409)
    await assert.rejects(second, { code: 'desktop/sign-in-cancelled', message: /too long/ })

    const third = signIn.start()
    signIn.cancel()
    await assert.rejects(third, { code: 'desktop/sign-in-cancelled', message: /cancelled/ })
  } finally {
    await server.close()
  }
})

test('other methods on the hand-off address are refused', async () => {
  const { server, origin } = await setUp()
  try {
    const status = await new Promise((resolve, reject) => {
      http
        .get(`${origin.replace('localhost', '127.0.0.1')}/desktop-sign-in/complete`, { headers: { host: new URL(origin).host } }, (response) => {
          response.resume()
          resolve(response.statusCode)
        })
        .on('error', reject)
    })
    assert.equal(status, 405)
  } finally {
    await server.close()
  }
})
