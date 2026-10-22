import '../index.css'
import '../styles/components.css'
import '../styles/shell.css'
import '../styles/pages.css'
import { useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { GoogleAuthProvider, inMemoryPersistence, setPersistence, signInWithPopup, signOut } from 'firebase/auth'
import { ArrowUpRight, CheckCircle2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { GoogleLogo } from '../pages/Login'
import { auth } from '../services/firebase'
import vaultLogo from '../assets/dv.png'
import { VaultIllustration } from '../components/auth/VaultIllustration'

// Opened in the user's browser by the desktop app, from the app's own local
// server, because Google refuses to sign in inside the app's window. It signs
// in with Google here and posts the tokens back to the app (see
// desktop/src/browser-sign-in.cjs). The sign-in is kept in memory only and
// signed out straight after, so nothing stays signed in in this browser.

const driveScope = 'https://www.googleapis.com/auth/drive.file'
// Registered by the installed app (desktop/src/main.cjs); opening it brings the
// app's window to the front. It carries no data.
const appLink = 'documentvault://open'

type Step = 'ready' | 'working' | 'done' | 'failed'

function readRequest() {
  const params = new URLSearchParams(window.location.search)
  const local = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const state = params.get('state')
  if (!local || !state) return null
  return { state, mode: params.get('mode') === 'reauthorize' ? 'reauthorize' : 'login', hint: params.get('hint') ?? '' }
}

export default function DesktopSignIn() {
  const [request] = useState(readRequest)
  const [step, setStep] = useState<Step>('ready')
  const [message, setMessage] = useState<string | null>(null)

  async function handleSignIn() {
    if (!request) return
    setStep('working')
    setMessage(null)
    try {
      await setPersistence(auth, inMemoryPersistence)
      const provider = new GoogleAuthProvider()
      provider.addScope(driveScope)
      provider.setCustomParameters(request.hint ? { login_hint: request.hint } : { prompt: 'select_account' })
      const result = await signInWithPopup(auth, provider)
      const credential = GoogleAuthProvider.credentialFromResult(result)
      if (!credential?.idToken || !credential.accessToken) {
        throw new Error('Google did not grant access to Drive. Try again and allow access.')
      }
      const response = await fetch('/desktop-sign-in/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: request.state, idToken: credential.idToken, accessToken: credential.accessToken }),
      })
      if (!response.ok) {
        throw new Error(
          response.status === 409
            ? 'The app is no longer waiting for this sign-in. Choose Continue with Google in the app again.'
            : 'The Document Vault app did not accept the sign-in. Make sure it is still open and try again.',
        )
      }
      // The one-time code has been used; keep it out of the browser history.
      window.history.replaceState(null, '', window.location.pathname)
      setStep('done')
      // The app also raises itself, but Windows may keep the browser in front.
      window.location.assign(appLink)
    } catch (error) {
      console.error(error)
      setMessage(describe(error))
      setStep('failed')
    } finally {
      await signOut(auth).catch(() => undefined)
    }
  }

  return (
    <main className="login">
      <section className="login__panel">
        <span className="brand">
          <img src={vaultLogo} alt="" aria-hidden="true" />
          <span>Document Vault</span>
        </span>

        <div className="login__body">
          {!request ? (
            <>
              <h1>Sign in from the app</h1>
              <p>
                This page is opened by the Document Vault desktop app. Choose Continue with Google in the app to sign in.
              </p>
              <p>
                <Link to="/">Go to the home page</Link>
              </p>
            </>
          ) : step === 'done' ? (
            <>
              <h1>You're signed in</h1>
              <p className="notice" role="status">
                <CheckCircle2 aria-hidden="true" /> Document Vault is now signed in. You can close this tab.
              </p>
              <a className="primary-button login__open-app" href={appLink}>
                <span>Open Document Vault</span>
                <ArrowUpRight aria-hidden="true" />
              </a>
              <p className="login__fineprint">
                If your browser asks, allow it to open Document Vault.
              </p>
            </>
          ) : (
            <>
              <h1>{request.mode === 'reauthorize' ? 'Reconnect Google Drive' : 'Sign in to the Document Vault app'}</h1>
              <p>
                Google does not allow signing in inside desktop apps, so the app opened this page in your browser. Continue with
                Google here and you will go straight back to the app. This browser does not stay signed in.
              </p>
              {message ? (
                <p className="notice notice--error" role="alert">
                  {message}
                </p>
              ) : null}
              <button type="button" className="login__google" onClick={() => void handleSignIn()} disabled={step === 'working'}>
                <GoogleLogo />
                <span>{step === 'working' ? 'Waiting for Google...' : 'Continue with Google'}</span>
              </button>
              <p className="login__fineprint">
                You will be asked to let Document Vault create and open files it manages in your Drive.
              </p>
            </>
          )}
        </div>
      </section>

      <div className="login__visual">
        <VaultIllustration />
      </div>
    </main>
  )
}

function describe(error: unknown) {
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/popup-blocked') return 'Your browser blocked the Google window. Allow pop-ups for this page and try again.'
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      return 'Google sign-in was cancelled. Try again when you are ready.'
    }
  }
  if (error instanceof TypeError) return 'Could not reach the Document Vault app. Make sure it is still open and try again.'
  return error instanceof Error ? error.message : 'Sign-in did not finish. Try again.'
}
