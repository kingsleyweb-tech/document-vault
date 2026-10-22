import { Link } from 'react-router-dom'
import { ClosingCta, PageHead } from '../ui'
import { usePageMeta } from '../meta'

export default function About() {
  usePageMeta('About', 'Why Document Vault exists and the principles it is built on.')

  return (
    <>
      <PageHead eyebrow="About" title="Built to keep important records safe and close at hand" />
      <section className="site-section">
        <div className="site-container">
          <div className="site-prose">
            <p className="site-lead">
              Document Vault started with a simple need. Certificates, service documents, school records and reports were
              spread across phones, email and USB drives, and finding the right one at the right moment was harder than it
              should be.
            </p>
            <h2>What it is for</h2>
            <p>
              Document Vault is a private workspace for a small number of trusted people. Each person signs in with their own
              Google account and gets their own vault. It is designed for records you need to keep for years and find in
              seconds, not for collaboration or sharing.
            </p>
            <h2>Principles</h2>
            <ul>
              <li>
                <strong>Your storage, your files.</strong> Documents live in your own Google Drive, so you are never locked in.
                You can see and download them from Drive at any time.
              </li>
              <li>
                <strong>Least access.</strong> Document Vault asks Google only for the files it creates or that you open with it,
                not your whole Drive.
              </li>
              <li>
                <strong>Honest about limits.</strong> The documentation and the <Link to="/security">security page</Link> say
                what has been checked and what has not.
              </li>
              <li>
                <strong>Calm and quick.</strong> No advertising, no clutter, and documents that open fast.
              </li>
            </ul>
            <h2>Where it runs</h2>
            <p>
              Document Vault runs in the browser, can be installed as an app on phones and computers, and has a desktop app for
              Windows, macOS and Linux. See <Link to="/downloads">Downloads</Link> for what is available today.
            </p>
          </div>
        </div>
      </section>
      <ClosingCta />
    </>
  )
}
