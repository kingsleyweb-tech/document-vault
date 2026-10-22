// Firestore security rules, run against the local emulator:
//   npm run test:rules
// Skipped when no emulator is running. Uses a demo project, so nothing ever
// reaches the real Firebase project.
import fs from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc, Timestamp } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST

describe.skipIf(!emulatorHost)('Firestore rules', () => {
  let env: RulesTestEnvironment

  beforeAll(async () => {
    const [host, port] = emulatorHost!.split(':')
    env = await initializeTestEnvironment({
      projectId: 'demo-document-vault',
      firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host, port: Number(port) },
    })
  })

  afterAll(async () => {
    await env?.cleanup()
  })

  beforeEach(async () => {
    await env.clearFirestore()
  })

  const alice = () => env.authenticatedContext('alice').firestore()
  const bob = () => env.authenticatedContext('bob').firestore()

  // The fields the app writes for a new upload (services/firestore.ts newDocumentFields).
  const newDocument = (ownerId = 'alice', extra: Record<string, unknown> = {}) => ({
    ownerId,
    name: 'Report',
    originalName: 'Report.pdf',
    mimeType: 'application/pdf',
    fileType: 'pdf',
    fileSize: 1234,
    category: 'Work',
    description: '',
    driveFileId: 'drive-1',
    driveFolderId: 'drive-folder-1',
    parentId: null,
    folderId: null,
    folderPath: '',
    tags: ['tax'],
    contentHash: 'a'.repeat(64),
    searchText: 'report',
    version: 1,
    isFavorite: false,
    isDeleted: false,
    uploadedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastViewedAt: null,
    ...extra,
  })

  async function seedDocument(data: Record<string, unknown> = {}) {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'documents/doc-1'), { ...newDocument('alice'), uploadedAt: Timestamp.now(), createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...data })
    })
  }

  describe('documents', () => {
    it('lets the owner create an upload record with the app’s fields', async () => {
      await assertSucceeds(setDoc(doc(alice(), 'documents/doc-1'), newDocument()))
    })

    it('accepts a record written by the currently deployed app (no tags, hash or version)', async () => {
      const legacy: Record<string, unknown> = newDocument()
      delete legacy.tags
      delete legacy.contentHash
      delete legacy.version
      await assertSucceeds(setDoc(doc(alice(), 'documents/doc-1'), legacy))
    })

    it('rejects records for someone else, unknown fields and bad values', async () => {
      await assertFails(setDoc(doc(alice(), 'documents/doc-1'), newDocument('bob')))
      await assertFails(setDoc(doc(alice(), 'documents/doc-1'), newDocument('alice', { isAdmin: true })))
      await assertFails(setDoc(doc(alice(), 'documents/doc-1'), newDocument('alice', { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })))
      await assertFails(setDoc(doc(alice(), 'documents/doc-1'), newDocument('alice', { contentHash: 'not-a-hash' })))
      await assertFails(setDoc(doc(alice(), 'documents/doc-1'), newDocument('alice', { uploadedAt: Timestamp.fromMillis(0) })))
      await assertFails(setDoc(doc(alice(), 'documents/doc-1'), newDocument('alice', { driveFileId: '' })))
    })

    it('lets the owner make every change the app makes', async () => {
      await seedDocument()
      const ref = doc(alice(), 'documents/doc-1')
      const now = serverTimestamp()
      await assertSucceeds(updateDoc(ref, { name: 'Renamed', originalName: 'Renamed.pdf', updatedAt: now }))
      await assertSucceeds(updateDoc(ref, { category: 'Personal', description: 'notes', tags: ['tax', '2026'], updatedAt: now }))
      await assertSucceeds(updateDoc(ref, { isFavorite: true, updatedAt: now }))
      await assertSucceeds(updateDoc(ref, { isDeleted: true, updatedAt: now }))
      await assertSucceeds(updateDoc(ref, { driveMissing: true, updatedAt: now }))
      await assertSucceeds(updateDoc(ref, { lastViewedAt: now, updatedAt: now }))
      await assertSucceeds(updateDoc(ref, { parentId: 'f1', folderId: 'f1', driveFolderId: 'drive-folder-2', folderPath: 'Work', updatedAt: now }))
      await assertSucceeds(updateDoc(ref, { fileSize: 99, mimeType: 'application/pdf', contentHash: 'b'.repeat(64), version: 2, updatedAt: now }))
    })

    it('lets an upload rewrite its own record after a lost reply', async () => {
      await seedDocument()
      await assertSucceeds(setDoc(doc(alice(), 'documents/doc-1'), newDocument()))
    })

    it('keeps records editable when they hold values older code wrote', async () => {
      await seedDocument({ legacyField: 'kept', lastViewedAt: Timestamp.fromMillis(1000) })
      await assertSucceeds(updateDoc(doc(alice(), 'documents/doc-1'), { isFavorite: true, updatedAt: serverTimestamp() }))
    })

    it('never lets the owner or Drive file of a record change', async () => {
      await seedDocument()
      const ref = doc(alice(), 'documents/doc-1')
      await assertFails(updateDoc(ref, { ownerId: 'bob' }))
      await assertFails(updateDoc(ref, { driveFileId: 'drive-other' }))
      await assertFails(updateDoc(ref, { isAdmin: true }))
      await assertFails(updateDoc(ref, { version: 0 }))
      await assertFails(updateDoc(ref, { tags: 'tax' }))
      await assertFails(updateDoc(ref, { createdAt: Timestamp.fromMillis(0) }))
      await assertFails(updateDoc(ref, { name: deleteField() }))
    })

    it('hides and protects records from other users', async () => {
      await seedDocument()
      await assertFails(getDoc(doc(bob(), 'documents/doc-1')))
      await assertFails(updateDoc(doc(bob(), 'documents/doc-1'), { isFavorite: true }))
      await assertSucceeds(getDoc(doc(alice(), 'documents/doc-1')))
      await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'documents/doc-1')))
    })
  })

  describe('folders', () => {
    const newFolder = (extra: Record<string, unknown> = {}) => ({
      ownerId: 'alice',
      name: 'Work',
      parentFolderId: null,
      driveFolderId: 'drive-folder-1',
      searchText: 'work',
      isFavorite: false,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...extra,
    })

    it('allows the app’s folder writes and nothing else', async () => {
      const ref = doc(alice(), 'folders/f1')
      await assertSucceeds(setDoc(ref, newFolder()))
      await assertSucceeds(updateDoc(ref, { name: 'Renamed', isFavorite: true, isDeleted: true, parentFolderId: 'f0', updatedAt: serverTimestamp() }))
      await assertFails(updateDoc(ref, { driveFolderId: 'other' }))
      await assertFails(updateDoc(ref, { ownerId: 'bob' }))
      await assertFails(updateDoc(ref, { color: 'red' }))
      await assertFails(setDoc(doc(alice(), 'folders/f2'), newFolder({ ownerId: 'bob' })))
      await assertFails(updateDoc(doc(bob(), 'folders/f1'), { name: 'Taken' }))
    })
  })

  describe('users', () => {
    it('lets a user write only their own profile fields', async () => {
      const ref = doc(alice(), 'users/alice')
      await assertSucceeds(setDoc(ref, { email: 'a@example.test', displayName: 'A', photoURL: '', updatedAt: serverTimestamp() }, { merge: true }))
      await assertSucceeds(setDoc(ref, { driveFolderId: 'root', driveConnected: true, driveConnectedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true }))
      await assertFails(setDoc(ref, { role: 'admin' }, { merge: true }))
      await assertFails(setDoc(doc(alice(), 'users/bob'), { email: 'x' }))
      await assertFails(getDoc(doc(bob(), 'users/alice')))
    })
  })
})
