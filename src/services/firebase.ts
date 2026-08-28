import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getAnalytics, isSupported } from 'firebase/analytics'

const firebaseConfig = {
  apiKey: 'AIzaSyD2iBLsST0GnQV3QhhUls0mBHScu-DJT3U',
  authDomain: 'document-vault-76520.firebaseapp.com',
  projectId: 'document-vault-76520',
  storageBucket: 'document-vault-76520.firebasestorage.app',
  messagingSenderId: '393631457328',
  appId: '1:393631457328:web:e7eb81d8db666a84bdcdf5',
  measurementId: 'G-GYFPX9B5XZ',
}

export const firebaseRuntimeInfo = {
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)

if (firebaseConfig.measurementId) {
  void isSupported().then((supported) => {
    if (supported) {
      getAnalytics(app)
    }
  })
}
