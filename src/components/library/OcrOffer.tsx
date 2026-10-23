import { useState } from 'react'
import { ScanText } from 'lucide-react'
import { companion, type LocalRoot } from '../../services/desktopCompanion'
import { errorText, numberFormat, offersOcr } from './libraryText'

interface OcrOfferProps {
  root: LocalRoot
  onDecided: (root: LocalRoot) => void
}

/**
 * Asks once per library whether to recognise the words on its scanned pages.
 * Nothing is recognised until the owner agrees; "Not now" turns it off, and it
 * can be turned on later in the library's settings.
 */
export function OcrOffer({ root, onDecided }: OcrOfferProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!offersOcr(root) || !root.ocr) return null
  const { scannedDocs, scannedPages } = root.ocr

  const decide = async (decision: 'on' | 'not-now') => {
    setBusy(true)
    setError(null)
    try {
      onDecided((await companion.decideOcr(root.id, decision)).root)
    } catch (caught) {
      setError(errorText(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ocr-offer" role="region" aria-label={`Recognise scanned text in ${root.name}`}>
      <ScanText aria-hidden="true" className="ocr-offer__icon" />
      <div className="ocr-offer__body">
        <p>
          <strong>
            {numberFormat.format(scannedDocs)} scanned {scannedDocs === 1 ? 'document' : 'documents'} ({numberFormat.format(scannedPages)}{' '}
            {scannedPages === 1 ? 'page' : 'pages'})
          </strong>{' '}
          can only be found by name, because {scannedDocs === 1 ? 'its pages are pictures' : 'their pages are pictures'}. Recognise
          their text on this computer so you can search their words?
        </p>
        <p className="ocr-offer__note">
          This runs in the background and is slow, about 5 to 10 seconds per page (a 300-page book can take 30 to 50 minutes), and uses the processor while it runs. Nothing is
          uploaded. You can turn it off at any time in the library's settings.
        </p>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="ocr-offer__actions">
          <button type="button" className="primary-button button--small" disabled={busy} onClick={() => void decide('on')}>
            Recognise text
          </button>
          <button type="button" className="secondary-button button--small" disabled={busy} onClick={() => void decide('not-now')}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
