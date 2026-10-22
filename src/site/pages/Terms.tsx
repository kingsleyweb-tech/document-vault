import { Link } from 'react-router-dom'
import { Callout, PageHead, ReviewNote, ReadingLayout } from '../ui'
import { usePageMeta } from '../meta'

export default function Terms() {
  usePageMeta('Terms of use', 'The terms for using Document Vault.')

  return (
    <>
      <PageHead eyebrow="Terms" title="Terms of use">
        The ground rules for using Document Vault.
      </PageHead>
      <section className="site-section site-section--tight">
        <div className="site-container">
          <ReadingLayout>
            <Callout tone="warn">
              <strong>Draft.</strong> These terms are a plain-language starting point and have not been reviewed by a lawyer.{' '}
              <ReviewNote />
            </Callout>

            <h2 id="service">The service</h2>
            <p>
              Document Vault is a private workspace for organising your own documents, provided to a small number of invited
              people. It is offered as is, free of charge, and may change or be discontinued. <ReviewNote>Confirm wording</ReviewNote>
            </p>

            <h2 id="account">Your account</h2>
            <ul>
              <li>You sign in with your own Google account and are responsible for keeping it secure.</li>
              <li>Do not share your sign-in or let others use your vault.</li>
              <li>You must also follow Google’s terms for your Google account and Google Drive.</li>
            </ul>

            <h2 id="content">Your content</h2>
            <ul>
              <li>Your documents remain yours. Document Vault claims no ownership of them.</li>
              <li>
                You allow Document Vault to store, read and process your documents only as needed to provide its features, such as
                previews and search. See the <Link to="/privacy">privacy notice</Link>.
              </li>
              <li>Only upload documents you have the right to keep.</li>
            </ul>

            <h2 id="acceptable-use">Acceptable use</h2>
            <p>
              Do not use Document Vault to break the law, to store content you have no right to, or to attack, overload or
              probe the service or other people’s data.
            </p>

            <h2 id="backups">Backups</h2>
            <p>
              Your files are stored in your Google Drive. Keep your own backups of anything irreplaceable. Permanently deleted
              files cannot be recovered through Document Vault.
            </p>

            <h2 id="desktop">Desktop app</h2>
            <p>
              The desktop app is provided for your own computers. Download it only from the{' '}
              <Link to="/downloads">Downloads page</Link> and check its checksum.
            </p>

            <h2 id="liability">Liability</h2>
            <p>
              To the extent the law allows, Document Vault is provided without warranties, and its operator is not liable for lost
              data or indirect losses. <ReviewNote>Legal wording to be confirmed for your jurisdiction</ReviewNote>
            </p>

            <h2 id="changes">Changes</h2>
            <p>These terms may be updated. Continuing to use Document Vault after a change means accepting the new terms.</p>
          </ReadingLayout>
        </div>
      </section>
    </>
  )
}
