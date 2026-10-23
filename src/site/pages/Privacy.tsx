import { Link } from 'react-router-dom'
import { Callout, PageHead, ReviewNote, ReadingLayout } from '../ui'
import { usePageMeta } from '../meta'

export default function Privacy() {
  usePageMeta('Privacy', 'What Document Vault collects, where it is kept, and the choices you have.')

  return (
    <>
      <PageHead eyebrow="Privacy" title="Privacy notice">
        What Document Vault collects, why, where it is kept, and what you can do about it.
      </PageHead>
      <section className="site-section site-section--tight">
        <div className="site-container">
          <ReadingLayout>
            <Callout tone="warn">
              <strong>Draft.</strong> This notice describes how the software works today. It has not yet been reviewed by a
              lawyer, and the operator’s name and contact details still need to be added. <ReviewNote />
            </Callout>

            <h2 id="who">Who is responsible</h2>
            <p>
              Document Vault is run privately for a small number of invited people. The person who operates this installation is
              responsible for the data described here. <ReviewNote>Operator name and contact to be confirmed</ReviewNote>
            </p>

            <h2 id="what">What is collected</h2>
            <ul>
              <li>
                <strong>Your Google account basics</strong>: name, email address, profile picture and Google account identifier,
                received when you sign in. Used to identify your vault and show who is signed in.
              </li>
              <li>
                <strong>Your documents</strong>: stored in your own Google Drive, not on Document Vault’s servers.
              </li>
              <li>
                <strong>Document details</strong>: file names, folders, categories, tags, descriptions, sizes, dates, versions and
                a fingerprint (SHA-256) of each file’s contents used to spot duplicates.
              </li>
              <li>
                <strong>Text from your documents</strong>: the words read from your documents (including by text recognition, if
                you turn it on) are stored so you can search inside them.
              </li>
              <li>
                <strong>On your device only</strong>: offline copies, prepared previews, your theme and view preferences, a Google
                Drive access token (for at most 55 minutes) and, in the desktop app, the index of the library folders you chose, including the text read from their documents.
              </li>
            </ul>
            <p>
              Document Vault does not use analytics, advertising or tracking cookies, and does not sell or share your data for
              marketing.
            </p>

            <h2 id="services">Services that process your data</h2>
            <div className="site-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Service</th>
                    <th scope="col">Used for</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Google (Firebase Authentication, Cloud Firestore, Google Drive)</td>
                    <td>Sign-in, document details, and storing your files in your Drive</td>
                  </tr>
                  <tr>
                    <td>Supabase</td>
                    <td>The search database: document details and text read from documents</td>
                  </tr>
                  <tr>
                    <td>Vercel</td>
                    <td>Hosting the website; receives standard request information such as IP address</td>
                  </tr>
                  <tr>
                    <td>Google Fonts</td>
                    <td>The typeface inside the workspace; your browser requests it from Google</td>
                  </tr>
                  <tr>
                    <td>GitHub</td>
                    <td>Hosting desktop app downloads, once published</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Data may be processed outside your country by these providers. <ReviewNote>Database regions to be confirmed</ReviewNote>
            </p>

            <h2 id="retention">How long it is kept</h2>
            <ul>
              <li>Document details and search text are kept until you permanently delete the document, which removes them.</li>
              <li>Files in your Google Drive stay until you delete them, in Document Vault or in Drive.</li>
              <li>Data on your device is removed when you sign out, or by clearing the site’s data in your browser.</li>
              <li>
                Your account record is kept while you use Document Vault. <ReviewNote>Retention after an account stops being used to be confirmed</ReviewNote>
              </li>
            </ul>

            <h2 id="choices">Your choices</h2>
            <ul>
              <li>See, download or delete any document from Document Vault or from Google Drive at any time.</li>
              <li>Turn text recognition off in Settings.</li>
              <li>
                Remove Document Vault’s access in your Google account under Security, Third-party apps with account access. Your
                files stay in your Drive.
              </li>
              <li>
                To have your account record and all document details deleted, ask the operator. There is no self-service account
                deletion yet.
              </li>
            </ul>

            <h2 id="security">Security</h2>
            <p>
              See the <Link to="/security">security page</Link> for how data is protected and the current limits.
            </p>

            <h2 id="changes">Changes to this notice</h2>
            <p>When the software changes how it handles data, this page is updated at the same time.</p>
          </ReadingLayout>
        </div>
      </section>
    </>
  )
}
