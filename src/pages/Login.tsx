import { useEffect, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { cancelBrowserSignIn, signInWithGoogle, signsInThroughBrowser } from '../services/auth'
import { useAuth } from '../hooks/useAuth'
import { canShowSignInPage, clearSignInNotes, isDesktopApp, rememberedDestination, safeNextPath } from '../routing'
import loginImage from '../assets/col.png'
import vaultLogo from '../assets/dv.png'

export function GoogleLogo() {
  return (
    <svg className="google-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.78-.07-1.53-.2-2.25H12v4.26h6.45a5.52 5.52 0 0 1-2.39 3.62v2.96h3.87c2.26-2.08 3.56-5.14 3.56-8.59Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.87-2.96c-1.07.72-2.43 1.14-4.06 1.14-3.13 0-5.78-2.11-6.73-4.95H1.29v3.05A11.99 11.99 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.33A7.21 7.21 0 0 1 4.89 12c0-.81.14-1.6.38-2.33V6.62H1.29A11.99 11.99 0 0 0 0 12c0 1.94.46 3.78 1.29 5.38l3.98-3.05Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.72c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.16 15.24 0 12 0A11.99 11.99 0 0 0 1.29 6.62l3.98 3.05C6.22 6.83 8.87 4.72 12 4.72Z"
      />
    </svg>
  )
}

export function Login({ mode = 'sign-in' }: { mode?: 'sign-in' | 'register' }) {
  const { isAuthenticated, loading } = useAuth()
  const [searchParams] = useSearchParams()
  const next = safeNextPath(searchParams.get('next') ?? rememberedDestination(), window.location.origin)
  const signedIn = !loading && isAuthenticated
  const navigate = useNavigate()
  // Only reachable from the site's Sign in, Get started and Open the web app
  // buttons (or the desktop app); a typed address goes to the home page.
  const [allowed] = useState(() => isDesktopApp() || canShowSignInPage())
  const [signInError, setSignInError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const buttonDisabled = loading || signingIn
  const throughBrowser = signsInThroughBrowser()

  async function handleGoogleSignIn() {
    setSignInError(null)
    setSigningIn(true)

    try {
      await signInWithGoogle()
    } catch (error) {
      console.error(error)
      setSignInError(getGoogleSignInErrorMessage(error))
    } finally {
      setSigningIn(false)
    }
  }

  // The workspace is a separate part of the site, so it opens with a full page load.
  useEffect(() => {
    if (signedIn) {
      clearSignInNotes()
      window.location.replace(next)
    } else if (!loading && !allowed) {
      navigate('/', { replace: true })
    }
  }, [signedIn, loading, allowed, next, navigate])

  if (signedIn) {
    return <div className="route-loader">Opening your vault...</div>
  }

  if (!allowed) {
    return <div className="route-loader">{loading ? 'Checking session...' : 'Redirecting...'}</div>
  }

  return (
    <main className="login">
      <section className="login__panel">
        <Link to="/" className="brand" aria-label="Document Vault home">
          <img src={vaultLogo} alt="" aria-hidden="true" />
          <span>Document Vault</span>
        </Link>

        <div className="login__body">
          <h1>{mode === 'register' ? 'Create your vault' : 'Your important records, organised.'}</h1>
          <p>
            Keep certificates, service documents, reports and personal files in one calm workspace. Every file is
            stored in your own Google Drive.
          </p>

          <ul className="login__points" aria-label="Highlights">
            <li>
              <ShieldCheck aria-hidden="true" />
              <span>Files stay in your Google Drive, private to you</span>
            </li>
            <li>
              <CheckCircle2 aria-hidden="true" />
              <span>Fast search, folders, favorites and previews</span>
            </li>
            <li>
              <LockKeyhole aria-hidden="true" />
              <span>Secure sign-in with your Google account</span>
            </li>
          </ul>

          {signInError ? (
            <p className="notice notice--error" role="alert">
              {signInError}
            </p>
          ) : null}
          <button type="button" className="login__google" onClick={() => void handleGoogleSignIn()} disabled={buttonDisabled}>
            <GoogleLogo />
            <span>
              {loading
                ? 'Checking session...'
                : signingIn
                  ? throughBrowser
                    ? 'Waiting for your browser...'
                    : 'Opening Google...'
                  : 'Continue with Google'}
            </span>
          </button>
          {signingIn && throughBrowser ? (
            <p className="login__fineprint" role="status">
              Google sign-in has opened in your web browser. Finish there and you will come straight back here.{' '}
              <button type="button" className="login__cancel" onClick={cancelBrowserSignIn}>
                Cancel
              </button>
            </p>
          ) : null}
          <p className="login__fineprint">
            {mode === 'register'
              ? 'There is no separate sign-up form: your vault is created the first time you continue with Google. '
              : ''}
            You will be asked to let Document Vault create and open files it manages in your Drive.
          </p>
          <p className="login__fineprint">
            <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/documentation/getting-started">Help signing in</Link>
          </p>
        </div>
      </section>

      <figure className="login__visual">
        <img src={loginImage} alt="Ghana Armed Forces public relations officers at a formal event" />
      </figure>
    </main>
  )
}

function getGoogleSignInErrorMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/popup-blocked') {
      return 'The Google popup was blocked. Allow popups for Document Vault and try again.'
    }

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      return 'Google sign-in was cancelled. Try again when you are ready.'
    }

    if (error.code === 'auth/unauthorized-domain') {
      return 'This domain is not authorized in Firebase Authentication. Add documents-vault.vercel.app in Firebase Authorized Domains.'
    }

    if (error.code === 'auth/account-exists-with-different-credential') {
      return 'This email is already connected with another sign-in method.'
    }

    return 'Google sign-in failed. Check Firebase Authentication, Google provider setup, and authorized domains.'
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Google sign-in failed. Check Firebase Authentication and Google OAuth settings.'
}
