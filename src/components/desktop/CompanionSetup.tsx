import { useState, type FormEvent } from 'react'
import { KeyRound, Laptop, RefreshCw, ShieldCheck } from 'lucide-react'
import { companion, CompanionError } from '../../services/desktopCompanion'
import type { CompanionConnection } from '../../hooks/useCompanion'

interface CompanionSetupProps {
  connection: Exclude<CompanionConnection, 'ready'>
  onConnected: () => void
  onRetry: () => void
}

// Shown until the companion is running and this browser is paired with it.
export function CompanionSetup({ connection, onConnected, onRetry }: CompanionSetupProps) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await companion.pair(code)
      setCode('')
      onConnected()
    } catch (caught) {
      setError(caught instanceof CompanionError ? caught.message : 'Pairing failed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="companion-setup" aria-labelledby="companion-setup-title">
      <div className="companion-setup__icon">
        <Laptop aria-hidden="true" />
      </div>
      <div className="companion-setup__body">
        <h2 id="companion-setup-title">
          {connection === 'unpaired' ? 'Connect this browser to your computer' : 'Start the Document Vault Companion'}
        </h2>
        <p>
          Websites cannot look through your computer's folders on their own. The companion is a small program that runs
          on this computer, indexes only the folders you choose and lets Document Vault find and open those files. Nothing
          is uploaded.
        </p>

        {connection === 'checking' ? <p className="companion-setup__state">Looking for the companion on this computer...</p> : null}

        {connection === 'offline' ? (
          <>
            <ol className="companion-steps">
              <li>
                Install and open the Document Vault desktop app (<a href="/downloads">Downloads</a>). Inside the app, Desktop
                Files works straight away.
              </li>
              <li>
                To use it from this browser too, keep the desktop app open and choose <strong>Help</strong>, then{' '}
                <strong>Connect a browser</strong>, to see a pairing code.
              </li>
              <li>This page connects automatically when the desktop app is running.</li>
            </ol>
            <p className="companion-setup__hint">
              Developers can instead run <code>npm run companion</code> in the project folder.
            </p>
            <button type="button" className="secondary-button" onClick={onRetry}>
              <RefreshCw aria-hidden="true" />
              <span>Check again</span>
            </button>
          </>
        ) : null}

        {connection === 'unpaired' ? (
          <form className="pairing-form" onSubmit={(event) => void submit(event)}>
            <label className="field">
              <span>Pairing code (desktop app: Help, Connect a browser)</span>
              <div className="pairing-form__row">
                <input
                  className="field-input pairing-form__input"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="ABCD-EFGH"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={12}
                  aria-describedby="pairing-help"
                  autoFocus
                />
                <button type="submit" className="primary-button" disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length !== 8}>
                  <KeyRound aria-hidden="true" />
                  <span>{busy ? 'Connecting...' : 'Connect'}</span>
                </button>
              </div>
            </label>
            <p id="pairing-help" className="companion-setup__hint">
              <ShieldCheck aria-hidden="true" />
              Only Document Vault on this computer can connect, and only with a code. Each code works once and expires after
              10 minutes.
            </p>
            {error ? (
              <p className="notice notice--error" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}
      </div>
    </section>
  )
}
