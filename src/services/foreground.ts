// Which document the viewer is showing. Heavy background work on a file
// (reading its text, OCR, hashing) waits until nothing is open, so it never
// competes with drawing the pages being read for memory.

let openFileId: string | null = null
let waiting: Array<() => void> = []

export function setOpenDocument(fileId: string | null) {
  openFileId = fileId
  if (fileId) return
  const ready = waiting
  waiting = []
  ready.forEach((resolve) => resolve())
}

export function openDocumentId() {
  return openFileId
}

/** Resolves once no document is open (at once when none is). */
export function whenNoDocumentOpen() {
  if (!openFileId) return Promise.resolve()
  return new Promise<void>((resolve) => waiting.push(resolve))
}
