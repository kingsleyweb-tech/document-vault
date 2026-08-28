import { useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { CheckCircle2, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Navigate } from 'react-router-dom'
import { signInWithGoogle } from '../services/auth'
import { useAuth } from '../hooks/useAuth'
import loginImage from '../assets/col.png'
import vaultLogo from '../assets/dv.png'

function GoogleLogo() {
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

export function Login() {
  const { isAuthenticated, loading } = useAuth()
  const [signInError, setSignInError] = useState<string | null>(null)
  const [signingIn, setSigningIn] = useState(false)
  const buttonDisabled = loading || signingIn

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

  if (!loading && isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <main className="login-page">
      <img className="login-mobile-background" src={loginImage} alt="" aria-hidden="true" />
      <section className="login-shell">
        <div className="login-content">
          <div className="brand brand--large">
            <img src={vaultLogo} alt="" aria-hidden="true" />
            <span>Document Vault</span>
          </div>
          <div className="login-copy">
            <span className="login-eyebrow">Military-grade document organization</span>
            <h1>Your secure vault for important records.</h1>
            <p>
              Keep certificates, service documents, reports, and personal files organized in one clean
              workspace backed by your Google Drive.
            </p>
          </div>
          <div className="login-highlights" aria-label="Document Vault highlights">
            <span>
              <ShieldCheck aria-hidden="true" />
              Private by default
            </span>
            <span>
              <CheckCircle2 aria-hidden="true" />
              Fast document lookup
            </span>
            <span>
              <LockKeyhole aria-hidden="true" />
              Secure Google sign-in
            </span>
          </div>
        </div>

        <div className="login-visual-panel">
          <img src={loginImage} alt="Ghana Armed Forces public relations officers at a formal event" />
          <div className="login-panel">
            <span className="login-badge login-mobile-signin-copy">
              <LockKeyhole aria-hidden="true" />
              Secure access
            </span>
            <div className="login-card-copy login-mobile-signin-copy">
              <h2>Welcome back</h2>
              <p>Continue with Google to open your document vault.</p>
            </div>
            <p className="login-desktop-signin-copy">Continue with Google to open your document vault.</p>
            {signInError ? (
              <p className="login-error" role="alert">
                {signInError}
              </p>
            ) : null}
            <button type="button" className="login-button" onClick={() => void handleGoogleSignIn()} disabled={buttonDisabled}>
              <GoogleLogo />
              <span>{loading ? 'Checking session...' : signingIn ? 'Opening Google...' : 'Continue with Google'}</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

function getGoogleSignInErrorMessage(error: unknown) {
  if (error instanceof FirebaseError) {
    if (error.code === 'auth/unauthorized-domain') {
      return 'This domain is not authorized in Firebase Authentication. Add the exact Vercel domain, then redeploy.'
    }

    if (error.code === 'auth/popup-blocked') {
      return 'Your browser blocked the Google sign-in popup. Allow popups for this site and try again.'
    }

    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
      return 'Google sign-in was closed before it finished. Try again.'
    }

    if (error.code === 'auth/operation-not-allowed') {
      return 'Google sign-in is not enabled for this Firebase project.'
    }

    if (error.code === 'auth/invalid-api-key' || error.code === 'auth/invalid-auth-event' || error.code === 'auth/configuration-not-found') {
      return `Firebase is not configured correctly in this deployment (${error.code}). Check the Vercel environment variables.`
    }

    return `Google sign-in failed (${error.code}). Check this domain in Firebase and Google Cloud OAuth settings.`
  }

  return 'Google sign-in failed. Check the browser console for the detailed error.'
}
