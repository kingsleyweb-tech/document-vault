import type { TreeSort } from './desktopCompanion'

// Where the person was on the library and search pages, so that leaving one
// (to read a web page, say) and coming back shows the same place. Kept for the
// session: in memory, and in sessionStorage so a reload keeps it too.

export interface LibraryPlace {
  tab: string
  sort: TreeSort
  /** Folders opened in the tree. */
  open: number[]
  /** The file opened last, shown again on return. */
  lastFile: number | null
}

export interface SearchPlace {
  query: string
  source: string
  filters: Record<string, unknown>
}

interface Places {
  /** Where "My Libraries" leads: the list, or the library last looked at. */
  libraries: string
  library: Record<number, LibraryPlace>
  search: SearchPlace | null
}

const KEY = 'documentVault.places'

function load(): Places {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Places | null
    if (saved && typeof saved.libraries === 'string' && saved.library) return saved
  } catch {
    // Storage blocked or unreadable: start afresh.
  }
  return { libraries: '/libraries', library: {}, search: null }
}

const places = load()

function save() {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(places))
  } catch {
    // Kept in memory only.
  }
}

export function librariesLink() {
  return places.libraries
}

export function setLibrariesLink(path: string) {
  if (places.libraries === path) return
  places.libraries = path
  save()
}

export function libraryPlace(libraryId: number): LibraryPlace {
  return places.library[libraryId] ?? { tab: 'folders', sort: 'name', open: [], lastFile: null }
}

export function updateLibraryPlace(libraryId: number, change: Partial<LibraryPlace>) {
  places.library[libraryId] = { ...libraryPlace(libraryId), ...change }
  save()
}

export function setFolderOpen(libraryId: number, folderId: number, open: boolean) {
  const current = libraryPlace(libraryId).open.filter((id) => id !== folderId)
  updateLibraryPlace(libraryId, { open: open ? [...current, folderId] : current })
}

export function forgetLibraryPlace(libraryId: number) {
  delete places.library[libraryId]
  if (places.libraries === `/libraries/${libraryId}`) places.libraries = '/libraries'
  save()
}

export function searchPlace() {
  return places.search
}

export function setSearchPlace(place: SearchPlace) {
  places.search = place
  save()
}

/** Navigation state for the Web browser page: where its "Back to" bar leads. */
export interface BackTo {
  to: string
  label: string
}

/** Forgets every remembered place (used by tests). */
export function forgetPlaces() {
  Object.assign(places, { libraries: '/libraries', library: {}, search: null })
  save()
}
