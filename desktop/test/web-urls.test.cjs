'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { addressFromInput, isAllowedFrameUrl, isAllowedRequest, isLoopbackHost, parseWebUrl, urlKey } = require('../src/web-urls.cjs')

test('opens only http and https web pages', () => {
  assert.equal(parseWebUrl('https://ghalii.org/judgments')?.href, 'https://ghalii.org/judgments')
  assert.equal(parseWebUrl('http://example.com/')?.href, 'http://example.com/')
  for (const refused of [
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'file:///C:/Users/me/Desktop/secret.pdf',
    'file://server/share/doc.pdf',
    'data:text/html,<script>alert(1)</script>',
    'blob:https://example.com/1234',
    'about:blank',
    'chrome://settings',
    'devtools://devtools/bundled/inspector.html',
    'ftp://example.com/file',
    'mailto:someone@example.com',
    'documentvault://open',
    'view-source:https://example.com',
    '',
    'not a url',
  ]) {
    assert.equal(parseWebUrl(refused), null, refused)
  }
})

test('refuses this computer, however it is written', () => {
  for (const address of [
    'http://localhost:47615/v1/status',
    'http://LOCALHOST./',
    'http://app.localhost/',
    'http://127.0.0.1:47616/app',
    'http://127.1.2.3/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://[::1]:47615/',
    'http://[::ffff:127.0.0.1]/',
    'http://0.0.0.0:47615/',
  ]) {
    assert.equal(parseWebUrl(address), null, address)
    assert.equal(isAllowedRequest(address), false, address)
  }
  assert.equal(isLoopbackHost('example.com'), false)
  assert.equal(isLoopbackHost('127.example.com'), false)
  // Tests may allow it, to serve pages from this computer.
  assert.ok(parseWebUrl('http://127.0.0.1:8080/', { allowLoopback: true }))
})

test('refuses addresses that hide a user name or password', () => {
  assert.equal(parseWebUrl('https://court.gov.gh@evil.example/'), null)
  assert.equal(parseWebUrl('https://user:pass@example.com/'), null)
})

test('turns what was typed into an address or a search', () => {
  assert.deepEqual(addressFromInput('ghalii.org'), { url: 'https://ghalii.org/' })
  assert.deepEqual(addressFromInput('  www.parliament.gh/acts?x=1 '), { url: 'https://www.parliament.gh/acts?x=1' })
  assert.deepEqual(addressFromInput('http://example.com/a'), { url: 'http://example.com/a' })
  assert.deepEqual(addressFromInput('example.com:8443/path'), { url: 'https://example.com:8443/path' })
  assert.deepEqual(addressFromInput('Article 129 Constitution of Ghana'), { url: 'https://duckduckgo.com/?q=Article%20129%20Constitution%20of%20Ghana' })
  assert.deepEqual(addressFromInput('habeas'), { url: 'https://duckduckgo.com/?q=habeas' })
  for (const refused of ['javascript:alert(1)', 'file:///C:/secret.txt', 'data:text/html,hi', 'localhost:47615', '127.0.0.1:47616/app', 'chrome://gpu']) {
    assert.ok(addressFromInput(refused).error, refused)
  }
  assert.ok(addressFromInput('   ').error)
})

test('pages may load their own parts over http, https, data and blob, never from files', () => {
  assert.equal(isAllowedRequest('https://cdn.example.com/a.js'), true)
  assert.equal(isAllowedRequest('wss://example.com/socket'), true)
  assert.equal(isAllowedRequest('data:image/png;base64,AAAA'), true)
  assert.equal(isAllowedRequest('blob:https://example.com/1'), true)
  assert.equal(isAllowedRequest('file:///C:/Windows/win.ini'), false)
  assert.equal(isAllowedRequest('chrome-extension://abc/x.js'), false)
  assert.equal(isAllowedRequest('ws://127.0.0.1:47615/'), false)
  assert.equal(isAllowedFrameUrl('about:srcdoc'), true)
  assert.equal(isAllowedFrameUrl('file:///C:/'), false)
  assert.equal(isAllowedFrameUrl('javascript:alert(1)'), false)
})

test('the same page written differently has the same key', () => {
  const key = urlKey('https://www.Example.com/acts/?utm_source=x&id=4#part-2')
  assert.equal(key, urlKey('http://example.com/acts?id=4'))
  assert.notEqual(key, urlKey('https://example.com/acts?id=5'))
})
