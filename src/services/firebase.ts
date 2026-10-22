import { initializeApp } from 'firebase/app'
import { browserLocalPersistence, browserPopupRedirectResolver, getAuth, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const requiredEnv = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const missingKeys = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => `VITE_FIREBASE_${key.replace(/[A-Z]/g, (letter) => `_${letter}`).toUpperCase()}`)

if (missingKeys.length > 0) {
  console.error(`Missing Firebase environment variables: ${missingKeys.join(', ')}`)
}

export const firebaseApp = initializeApp({
  ...requiredEnv,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
})

// The sign-in is kept in localStorage, falling back to IndexedDB where that is
// unavailable. It is chosen here, once: changing it after start-up moved the
// saved sign-in between the two on every page load, and a page closed by the
// browser mid-move (iOS does this to pages that use too much memory) lost it,
// which signed the user out.
export const auth = createAuth()

function createAuth() {
  try {
    return initializeAuth(firebaseApp, {
      persistence: [browserLocalPersistence, indexedDBLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    })
  } catch {
    // Outside a browser (the tests) these storages do not exist.
    return getAuth(firebaseApp)
  }
}
export const db = getFirestore(firebaseApp)
