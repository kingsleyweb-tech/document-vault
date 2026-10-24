'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { parseWebUrl, urlKey } = require('./web-urls.cjs')

// Saved references (bookmarks), their folders and recently visited pages, kept
// in one file in the app's own data folder. Websites never see this file: it is
// read and written only by the main process, on requests from the app's page.

const MAX_HISTORY = 300
const MAX_BOOKMARKS = 5000
const MAX_FOLDERS = 200
const LIMITS = { title: 300, note: 4000, folder: 80, sourceName: 300 }

const clip = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

function emptyData() {
  return { version: 1, bookmarks: [], folders: [], history: [] }
}

function createWebLibrary(file, { now = () => Date.now(), saveDelayMs = 250 } = {}) {
  let data = load(file)
  let timer = null

  function load(target) {
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'))
      return {
        version: 1,
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks.filter((item) => item && parseWebUrl(item.url)) : [],
        folders: Array.isArray(parsed.folders) ? parsed.folders.filter((name) => typeof name === 'string' && name) : [],
        history: Array.isArray(parsed.history) ? parsed.history.filter((item) => item && parseWebUrl(item.url)) : [],
      }
    } catch {
      return emptyData()
    }
  }

  function saveNow() {
    clearTimeout(timer)
    timer = null
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(data, null, 1), { mode: 0o600 })
    fs.renameSync(temporary, file)
  }

  function save() {
    if (saveDelayMs <= 0) return saveNow()
    if (!timer) {
      timer = setTimeout(saveNow, saveDelayMs)
      timer.unref?.()
    }
  }

  const findBookmark = (id) => {
    const bookmark = data.bookmarks.find((item) => item.id === id)
    if (!bookmark) throw new Error('This saved reference no longer exists.')
    return bookmark
  }

  function folderName(value) {
    const name = clip(value, LIMITS.folder)
    if (name && !data.folders.includes(name)) {
      if (data.folders.length >= MAX_FOLDERS) throw new Error('There are too many folders. Remove one first.')
      data.folders.push(name)
    }
    return name
  }

  function source(value) {
    if (!value || typeof value !== 'object') return null
    const name = clip(value.name, LIMITS.sourceName)
    const entryId = Number.isSafeInteger(value.entryId) ? value.entryId : null
    return name ? { name, entryId } : null
  }

  return {
    /** Everything, for the page. Bookmarks sharing an address are marked as duplicates. */
    snapshot() {
      const counts = new Map()
      for (const bookmark of data.bookmarks) counts.set(urlKey(bookmark.url), (counts.get(urlKey(bookmark.url)) ?? 0) + 1)
      return {
        folders: [...data.folders],
        bookmarks: data.bookmarks.map((bookmark) => ({ ...bookmark, duplicate: counts.get(urlKey(bookmark.url)) > 1 })),
        history: data.history.map((item) => ({ ...item })),
      }
    },

    /** Saves a page. An address already saved is not saved twice; the existing reference is returned. */
    saveBookmark(input) {
      const url = parseWebUrl(input?.url)
      if (!url) throw new Error('Only http and https web pages can be saved.')
      const existing = data.bookmarks.find((item) => urlKey(item.url) === urlKey(url.href))
      if (existing) return { bookmark: { ...existing }, existed: true }
      if (data.bookmarks.length >= MAX_BOOKMARKS) throw new Error('There are too many saved references. Remove some first.')
      const bookmark = {
        id: crypto.randomUUID(),
        url: url.href,
        title: clip(input.title, LIMITS.title) || url.hostname,
        note: clip(input.note, LIMITS.note),
        folder: folderName(input.folder),
        source: source(input.source),
        createdAt: now(),
        updatedAt: now(),
        check: null,
      }
      data.bookmarks.unshift(bookmark)
      save()
      return { bookmark: { ...bookmark }, existed: false }
    },

    updateBookmark(id, changes) {
      const bookmark = findBookmark(id)
      if (changes.url !== undefined) {
        const url = parseWebUrl(changes.url)
        if (!url) throw new Error('Only http and https web pages can be saved.')
        if (url.href !== bookmark.url) bookmark.check = null
        bookmark.url = url.href
      }
      if (changes.title !== undefined) bookmark.title = clip(changes.title, LIMITS.title) || new URL(bookmark.url).hostname
      if (changes.note !== undefined) bookmark.note = clip(changes.note, LIMITS.note)
      if (changes.folder !== undefined) bookmark.folder = folderName(changes.folder)
      bookmark.updatedAt = now()
      save()
      return { ...bookmark }
    },

    removeBookmark(id) {
      data.bookmarks = data.bookmarks.filter((item) => item.id !== id)
      save()
    },

    setCheck(id, check) {
      const bookmark = data.bookmarks.find((item) => item.id === id)
      if (!bookmark) return
      bookmark.check = check
      save()
    },

    addFolder(name) {
      const folder = folderName(name)
      if (!folder) throw new Error('Give the folder a name.')
      save()
      return folder
    },

    renameFolder(from, to) {
      const name = clip(to, LIMITS.folder)
      if (!name) throw new Error('Give the folder a name.')
      if (!data.folders.includes(from)) throw new Error('This folder no longer exists.')
      if (name !== from && data.folders.includes(name)) throw new Error('There is already a folder with that name.')
      data.folders = data.folders.map((folder) => (folder === from ? name : folder))
      for (const bookmark of data.bookmarks) if (bookmark.folder === from) bookmark.folder = name
      save()
    },

    /** Removes a folder; its references are kept, outside any folder. */
    removeFolder(name) {
      data.folders = data.folders.filter((folder) => folder !== name)
      for (const bookmark of data.bookmarks) if (bookmark.folder === name) bookmark.folder = ''
      save()
    },

    /** Records a visit. Visiting the same page again moves it to the top instead of adding it twice. */
    recordVisit({ url, title }) {
      const parsed = parseWebUrl(url)
      if (!parsed) return
      const key = urlKey(parsed.href)
      const previous = data.history.find((item) => urlKey(item.url) === key)
      data.history = data.history.filter((item) => item !== previous)
      data.history.unshift({ id: previous?.id ?? crypto.randomUUID(), url: parsed.href, title: clip(title, LIMITS.title) || previous?.title || parsed.hostname, visitedAt: now() })
      if (data.history.length > MAX_HISTORY) data.history.length = MAX_HISTORY
      save()
    },

    /** Updates the title of the most recent visit to a page, once the page has told us its title. */
    titleVisit(url, title) {
      const item = data.history.find((entry) => entry.url === url)
      if (!item || !title) return
      item.title = clip(title, LIMITS.title)
      save()
    },

    removeVisit(id) {
      data.history = data.history.filter((item) => item.id !== id)
      save()
    },

    clearHistory() {
      data.history = []
      save()
    },

    bookmarkUrls(ids) {
      return data.bookmarks.filter((item) => ids === null || ids.includes(item.id)).map((item) => ({ id: item.id, url: item.url }))
    },

    flush() {
      if (timer) saveNow()
    },
  }
}

module.exports = { createWebLibrary }
